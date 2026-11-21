import {backupRecords, parseBackup, restoreRecords} from "./backup.js";

function documentUrl(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw Error("请输入完整的 WebDAV 文件地址。"); }
  const loopback = url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw Error("请使用 HTTPS，本机测试可使用 http://localhost 或 http://127.0.0.1。");
  if (url.username || url.password) throw Error("请把登录信息填写到认证栏。");
  if (url.hash || url.pathname.endsWith("/")) throw Error("请输入单个备份文件的地址，例如 /dav/daybreak.json。");
  return url;
}

function requestPermission(url) {
  if (!globalThis.chrome?.permissions) return Promise.resolve(true);
  return chrome.permissions.request({origins:[url.protocol + "//" + url.hostname + "/*"]});
}

function authorization(method, user, secret) {
  if (method === "none") return {};
  if (!secret) throw Error("请填写密码或令牌，或选择免登录。");
  if (method === "bearer") {
    if (/\s/.test(secret)) throw Error("访问令牌中不能包含空白字符。");
    return {Authorization:"Bearer " + secret};
  }
  if (!user || user.includes(":")) throw Error("请填写有效的 WebDAV 用户名。");
  const bytes = new TextEncoder().encode(user + ":" + secret);
  return {Authorization:"Basic " + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""))};
}

async function request(url, method, headers, body) {
  try {
    return await fetch(url, {method, headers, body, cache:"no-store", credentials:"omit", redirect:"error",
      referrerPolicy:"no-referrer", signal:AbortSignal.timeout(60000)});
  } catch { throw Error("无法连接 WebDAV。请检查网络、证书，并填写文件的最终地址。"); }
}
function httpError(status) {
  if (status === 401 || status === 403) return Error("WebDAV 拒绝访问，请检查认证信息和文件权限。");
  if (status === 409) return Error("远程文件所在目录不存在，或文件发生冲突。");
  if (status === 412) return Error("远程文件已改变，本次上传已停止。请重新预览最新版本。");
  if (status === 423) return Error("远程文件已锁定，请稍后重试。");
  if (status === 507) return Error("WebDAV 存储空间不足。");
  return Error("WebDAV 返回 HTTP " + status + "，操作未完成。");
}
function strongTag(response) {
  const tag = response.headers.get("etag")?.trim();
  return /^"[^"\r\n]*"$/.test(tag || "") ? tag : null;
}
async function readRemote(url, headers) {
  const response = await request(url, "GET", {...headers, Accept:"application/json"});
  if (response.status === 404) return {missing:true};
  if (!response.ok) throw httpError(response.status);
  let parsed;
  try { parsed = parseBackup(await response.text()); }
  catch { throw Error("这个远程文件不是可识别的备份。请检查地址，或为晨屿指定一个新文件。"); }
  return {missing:false,etag:strongTag(response),parsed};
}

export function mountWebDAV(root) {
  root.innerHTML = `<section class="dav-card"><h2>WebDAV 手动同步</h2>
    <p class="dav-help">使用自己的 WebDAV 文件在设备间备份。登录信息仅在当前页面使用。</p>
    <fieldset class="dav-fields"><label class="dav-url-label">备份文件地址<input class="dav-url" type="url" autocomplete="off" spellcheck="false" placeholder="https://example.com/dav/daybreak.json"></label>
      <label>认证方式<select class="dav-auth"><option value="none">免登录</option><option value="basic">用户名和密码</option><option value="bearer">Bearer 令牌</option></select></label>
      <label class="dav-user-label" hidden>用户名<input class="dav-user" autocomplete="off" spellcheck="false"></label>
      <label class="dav-secret-label" hidden><span>密码或应用密码</span><input class="dav-secret" type="password" autocomplete="off" spellcheck="false"></label>
      <div class="dav-actions"><button type="button" class="dav-inspect">预览远程备份</button><button type="button" class="dav-upload">上传本机备份</button></div>
      <div class="dav-preview" hidden><p class="dav-summary"></p><p class="dav-effect"></p><button type="button" class="dav-merge">合并预览到本机</button></div>
    </fieldset><p class="dav-status" role="status"></p></section>`;
  const el = name => root.querySelector(".dav-" + name);
  const fields = el("fields"), endpoint = el("url"), auth = el("auth"), user = el("user"), secret = el("secret");
  const preview = el("preview"), inspect = el("inspect"), upload = el("upload"), merge = el("merge"), status = el("status");
  let reviewed = null, active = true;
  function reset() {
    reviewed = null; preview.hidden = true;
    upload.textContent = "上传本机备份"; upload.disabled = false;
  }
  function updateAuth() {
    el("user-label").hidden = auth.value !== "basic";
    el("secret-label").hidden = auth.value === "none";
    el("secret-label").querySelector("span").textContent = auth.value === "bearer" ? "访问令牌" : "密码或应用密码";
  }
  for (const field of [endpoint,auth,user,secret]) field.addEventListener("input", () => {
    reset(); status.textContent = "";
    if (field === auth) { secret.value = ""; user.value = ""; updateAuth(); }
  });
  async function display(result, local) {
    if (!active) return;
    reviewed = result;
    if (result.missing) {
      preview.hidden = true; upload.disabled = false; upload.textContent = "创建远程备份";
      status.textContent = "远程文件尚未创建，可以上传第一份备份。"; return;
    }
    const remote = result.parsed.records, keys = Object.keys(remote);
    const unique = keys.filter(key => !Object.hasOwn(local, key)).length;
    const remoteOnly = unique ? "本机缺少其中 " + unique + " 条。" : "本机已有全部记录键。";
    el("summary").textContent = result.parsed.source + "备份，共 " + keys.length + " 条记录（" +
      keys.filter(key => key.startsWith("daybreak.favorite.")).length + " 个收藏、" +
      keys.filter(key => key.startsWith("daybreak.note.")).length + " 篇笔记、" +
      keys.filter(key => key.startsWith("daybreak.tasks.item.")).length + " 项待办）。" + remoteOnly;
    el("effect").textContent = "合并会保留本机已有内容。" + (result.etag
      ? "覆盖远程将写入全部本机备份，远程独有的记录会被移除。"
      : "服务器未提供强 ETag，现有文件仅支持读取。") + " " + result.parsed.warnings.join(" ");
    preview.hidden = false; upload.disabled = !result.etag; upload.textContent = "用本机备份覆盖远程";
    status.textContent = "远程备份已预览。";
  }
  function connect(job) {
    return async () => {
      if (fields.disabled) return;
      try {
        const url = documentUrl(endpoint.value);
        const headers = authorization(auth.value,user.value.trim(),secret.value);
        const permission = requestPermission(url);
        fields.disabled = true;
        if (!await permission) throw Error("访问这个 WebDAV 主机的权限未授予。");
        if (!active) return;
        status.textContent = "正在连接 WebDAV…";
        await job(url, headers);
      } catch (e) { if (active) status.textContent = e.message || "操作失败，请重试。"; }
      finally { if (active) fields.disabled = false; }
    };
  }
  inspect.onclick = connect(async (url,headers) => {
    reset();
    const result = await readRemote(url,headers);
    await display(result,await backupRecords());
  });
  upload.onclick = connect(async (url,headers) => {
    const records = await backupRecords();
    const version = reviewed || await readRemote(url, headers);
    if (!active) return;
    if (!reviewed && !version.missing) { await display(version,records); return; }
    if (!version.missing && !version.etag) throw Error("该文件没有强 ETag，无法安全覆盖。");
    const condition = version.missing ? {"If-None-Match":"*"} : {"If-Match":version.etag};
    const document = {format:"daybreak-backup", version:1, exportedAt:new Date().toISOString(), records};
    // Invalidate the previously reviewed version even if the PUT response is lost in transit.
    reset();
    const response = await request(url,"PUT",{...headers,...condition,"Content-Type":"application/json; charset=utf-8"},JSON.stringify(document));
    if (!response.ok) throw httpError(response.status);
    if (active) status.textContent = "已上传 " + Object.keys(records).length + " 条本机记录。";
  });
  merge.onclick = async () => {
    if (fields.disabled || !reviewed?.parsed) return;
    const records = reviewed.parsed.records;
    fields.disabled = true;
    try {
      await restoreRecords(records,"merge");
      if (active) { reset(); status.textContent = "合并完成，已有本机项目已保留。"; }
    } catch { if (active) status.textContent = "合并失败，请检查本机存储后重试。"; }
    finally { if (active) fields.disabled = false; }
  };
  return () => { active = false; reset(); secret.value = ""; user.value = ""; root.replaceChildren(); };
}
