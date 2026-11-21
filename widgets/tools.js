import { el } from "./home.js";

function button(label, action) {
  const node = el("button",label,"tool-button");
  node.type="button";
  node.addEventListener("click",action);
  return node;
}
const gmailOrigin = "https://mail.google.com/*";
export function mountTools(root) {
  let active=true, installed=[], listeners=[], listVersion=0;
  const panel=el("div",null,"tools-panel"), manager=el("section",null,"settings-card");
  const bar=el("div",null,"tool-bar"), status=el("p","","tool-status");
  const list=el("div",null,"extension-list"), query=el("input");
  query.type="search"; query.placeholder="搜索扩展名称";query.setAttribute("aria-label","搜索扩展名称");
  query.className="settings-field";query.hidden=true; status.setAttribute("role","status");
  function showExtensions() {
    if(!active)return;
    const q=query.value.trim().toLowerCase();
    const filtered=installed.filter(item=>item.name.toLowerCase().includes(q));
    const rows=filtered.map(item=>{
      const node=el("div",null,"extension-row");
      const label=el("div",null,"extension-label");
      label.append(el("strong",item.name),el("small",item.version+" · "+(item.enabled?"已启用":"已停用")));
      node.append(label);
      if(item.optionsUrl && item.enabled) node.append(button("选项",()=>chrome.tabs.create({url:item.optionsUrl})));
      if(item.id!==chrome.runtime.id && item.mayDisable && (item.enabled || item.mayEnable!==false)){
        const toggle=button(item.enabled?"停用":"启用",async()=>{
          toggle.disabled=true;
          try{await chrome.management.setEnabled(item.id,!item.enabled);await refresh();}
          catch{status.textContent="浏览器未完成此更改。";toggle.disabled=false;}
        });
        node.append(toggle);
        if(item.installType!=="admin"){
          const remove=button("卸载",async()=>{
            try{await chrome.management.uninstall(item.id,{showConfirmDialog:true});await refresh();}
            catch{status.textContent="已保留此扩展。";}
          });
          remove.setAttribute("aria-label","卸载 "+item.name); node.append(remove);
        }
      }
      return node;
    });
    list.replaceChildren(...(rows.length?rows:[el("p","没有匹配的扩展。","tool-status")]));
  }
  query.addEventListener("input",showExtensions);
  async function refresh() {
    const version=++listVersion;
    if(!globalThis.chrome?.management || !await chrome.permissions.contains({permissions:["management"]}))return;
    const all=await chrome.management.getAll();
    if(!active||version!==listVersion)return;
    installed=all.filter(item=>item.type==="extension"||item.type==="legacy_packaged_app"||item.type==="packaged_app"||item.type==="hosted_app")
      .sort((a,b)=>Number(b.enabled)-Number(a.enabled)||a.name.localeCompare(b.name,"zh-CN"));
    grant.hidden=true;query.hidden=false;status.textContent=installed.length+" 个扩展或应用";showExtensions();
    if(!listeners.length) for(const key of ["onEnabled","onDisabled","onInstalled","onUninstalled"]){
      const event=chrome.management[key]; const listener=()=>refresh().catch(()=>{});
      event.addListener(listener);listeners.push(()=>event.removeListener(listener));
    }
  }
  const grant=button("读取已安装的扩展",async()=>{
    try{
      if(await chrome.permissions.request({permissions:["management"]}))await refresh();
      else status.textContent="需要浏览器授权才能在这里管理扩展。";
    }catch{status.textContent="请在浏览器扩展管理页中查看。";}
  });
  const native=button("打开浏览器扩展管理页",()=>chrome.tabs.create({url:/Edg\//.test(navigator.userAgent)?"edge://extensions/":"chrome://extensions/"}));
  bar.append(query,grant,native);manager.append(el("h2","扩展管理"),bar,status,list);
  const gmail=el("section",null,"settings-card"), mailText=el("p","","tool-status");
  mailText.setAttribute("role","status");
  const settings=el("div",null,"tool-bar");
  let mailEnabled=false,notificationsEnabled=false;
  const enable=button("开启未读计数",async()=>{
    try{
      if(mailEnabled) {
        await chrome.storage.local.set({"daybreak.mail.enabled":false,"daybreak.mail.notify":false});
      }else if(await chrome.permissions.request({origins:[gmailOrigin]})){
        await chrome.storage.local.set({"daybreak.mail.enabled":true});
      }else {mailText.textContent="需要允许访问 Gmail 才能读取未读数。";return;}
      await mailState();
    }catch{mailText.textContent="浏览器未能更改 Gmail 设置。";}
  });
  const check=button("刷新未读数",async()=>{
    check.disabled=true;mailText.textContent="正在检查…";
    try{await chrome.runtime.sendMessage({type:"mail-check"});await mailState();}
    catch{mailText.textContent="读取失败，请重试。";}finally{check.disabled=false;}
  });
  const notify=button("开启新邮件通知",async()=>{
    const next=!notificationsEnabled;
    if(next && !await chrome.permissions.request({permissions:["notifications"]})) {mailText.textContent="浏览器未授予通知权限。";return;}
    await chrome.storage.local.set({"daybreak.mail.notify":next});await mailState();
  });
  const inbox=el("a","打开收件箱 ↗","tool-button");inbox.href="https://mail.google.com/mail/u/0/";inbox.target="_blank";inbox.rel="noopener";
  enable.disabled=true;check.hidden=notify.hidden=true;
  settings.append(enable,check,notify,inbox);
  gmail.append(el("h2","Gmail 未读邮件"),el("p","使用当前浏览器登录的 Google Workspace 邮箱。开启后，每五分钟检查一次未读数量。","tool-status"),settings,mailText);
  async function mailState(){
    const data=await chrome.storage.local.get(["daybreak.mail.enabled","daybreak.mail.notify","daybreak.runtime.mail"]);
    if(!active)return;
    const on=data["daybreak.mail.enabled"],latest=data["daybreak.runtime.mail"];
    mailEnabled=on===true;notificationsEnabled=data["daybreak.mail.notify"]===true;enable.disabled=false;
    enable.textContent=on?"关闭未读计数":"开启未读计数";
    notify.hidden=check.hidden=!on;
    notify.textContent=data["daybreak.mail.notify"]?"关闭新邮件通知":"开启新邮件通知";
    mailText.textContent=on?(latest?.error|| (Number.isFinite(latest?.count)?"收件箱有 "+latest.count+" 封未读邮件 · "+new Date(latest.time).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}):"等待检查未读数…")):"";
  }
  const changed=(changes,area)=>{if(area==="local" && Object.keys(changes).some(k=>k.startsWith("daybreak.mail.")||k==="daybreak.runtime.mail"))mailState().catch(()=>{});};
  chrome.storage.onChanged.addListener(changed);
  const ai=el("section",null,"settings-card");
  const chat=el("a","打开 AI 对话","tool-button");chat.href="#ai";
  ai.append(el("h2","AI 对话"),chat);
  panel.append(manager,gmail,ai);root.replaceChildren(panel);
  refresh().catch(()=>{status.textContent="无法读取扩展列表。";});mailState().catch(()=>{});
  return ()=>{active=false;for(const stop of listeners)stop();chrome.storage.onChanged.removeListener(changed);panel.remove();};
}
