const base = "http://127.0.0.1:11434";
const permission = "http://127.0.0.1/*";
const prefix = "daybreak.ai.chat.";
const modelKey = "daybreak.ai.model";
const storage = globalThis.chrome?.storage?.local;
let connectedModels = [];

function element(tag, name, text) {
  const node=document.createElement(tag);
  node.className="ai-"+name;
  if(text!==undefined) node.textContent=text;
  if(tag==="button") node.type="button";
  return node;
}
function fresh() {
  const now=Date.now();
  return {id:crypto.randomUUID(),title:"新对话",created:now,updated:now,messages:[]};
}
function valid(chat) {
  return chat && typeof chat.id==="string" && typeof chat.title==="string" && Array.isArray(chat.messages)
    && chat.messages.every(m=>m && ["user","assistant"].includes(m.role) && typeof m.content==="string");
}
function errorMessage(error) {
  return error instanceof TypeError ? "无法连接本机 Ollama，请确认服务在 127.0.0.1:11434 运行。" : error.message || "请求失败。";
}
async function checkResponse(response) {
  if(response.ok) return;
  if(response.status===403) throw new Error("本机服务拒绝此扩展。将 OLLAMA_ORIGINS 设置为 chrome-extension://"+chrome.runtime.id+" 后重启 Ollama，再次连接。");
  let detail="";
  try { detail=(await response.json()).error || ""; } catch {}
  throw new Error("Ollama 返回 "+response.status+(detail ? " · "+detail : "")+"。");
}
async function readChunks(response, onText) {
  const reader=response.body?.getReader();
  if(!reader) throw new Error("模型服务未返回数据。");
  const decoder=new TextDecoder();
  let pending="", finished=false;
  function parse(line) {
    if(!line.trim()) return;
    const chunk=JSON.parse(line);
    if(chunk.error) throw new Error(String(chunk.error));
    if(typeof chunk.message?.content==="string") onText(chunk.message.content);
    if(chunk.done===true) finished=true;
  }
  try {
    while(!finished) {
      const {value,done}=await reader.read();
      if(done) { pending+=decoder.decode();if(pending) parse(pending);break; }
      pending+=decoder.decode(value,{stream:true});
      let boundary;
      while((boundary=pending.indexOf("\n"))>=0) {
        parse(pending.slice(0,boundary));pending=pending.slice(boundary+1);
      }
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  if(!finished) throw new Error("模型连接提前结束，可以重试这条提问。");
}
function sessionLock(id,action) {
  return navigator.locks.request("daybreak.ai.chat."+id,{ifAvailable:true}, lock=>{
    if(!lock) throw new Error("另一个标签页正在写入此会话，请稍后再试。");
    return action();
  });
}
export function mountAI(root) {
  const panel=element("section","panel");
  const connection=element("div","connection");
  const info=element("div","connection-info");
  info.append(element("strong","service","本机 Ollama"),element("span","address","127.0.0.1:11434"));
  const model=element("select","select");
  model.setAttribute("aria-label","选择本地模型");
  const connect=element("button","action","连接本机");
  connection.append(info,model,connect);
  const hint=element("p","hint");
  hint.id="ai-connection-help";
  connect.setAttribute("aria-describedby",hint.id);
  const layout=element("div","layout");
  const aside=element("aside","sidebar");
  const heading=element("div","thread-head");
  heading.append(element("h2","heading","对话"));
  const add=element("button","action","新建对话");
  heading.append(add);
  const threads=element("div","threads");
  aside.append(heading,threads);
  const main=element("div","main");
  const top=element("div","thread-head");
  const title=element("h2","heading");
  const del=element("button","text-button","删除会话");
  top.append(title,del);
  const messages=element("div","messages");
  messages.setAttribute("aria-label","对话记录");
  messages.setAttribute("role","region");
  messages.tabIndex=0;
  const form=element("form","form");
  const input=element("textarea","input");
  input.placeholder="向本地模型提问…";
  input.setAttribute("aria-label","提问内容");
  input.rows=3;
  const footer=element("div","footer");
  const status=element("span","status");
  status.setAttribute("role","status");
  const retry=element("button","action","重新生成");
  const stop=element("button","action","停止生成");
  const send=element("button","primary","发送");
  send.type="submit";
  footer.append(status,retry,stop,send);form.append(input,footer);
  main.append(top,messages,form);layout.append(aside,main);panel.append(connection,hint,layout);root.replaceChildren(panel);

  const chats=new Map(),drafts=new Map();
  let current=fresh(), choice="", ready=false, active=null, connecting=null, mounted=true, deleting=false;
  let checkingDelete=false, initialized=false;
  let selectedId="";
  try {selectedId=sessionStorage.getItem("daybreak.ai.current") || "";} catch {}
  const order=()=>[...chats.values()].sort((a,b)=>b.updated-a.updated || a.id.localeCompare(b.id));
  const chosen=()=>active?.chat?.id===current.id ? active.chat : chats.get(current.id) || current;
  const notify=message=>{if(mounted) status.textContent=message;};
  function select(chat) {
    drafts.set(current.id,input.value);
    current=chat; selectedId=chat.id; input.value=drafts.get(chat.id) || "";checkingDelete=false;
    try {sessionStorage.setItem("daybreak.ai.current",chat.id);} catch {}
    notify(""); render();
  }
  function modelOptions() {
    model.replaceChildren();
    if(connectedModels.length) {
      model.append(...connectedModels.map(name=>new Option(name,name)));
      if(connectedModels.includes(choice)) model.value=choice;
      choice=model.value;
      ready=true;
    } else { model.append(new Option("尚未连接模型",""));ready=false; }
    model.disabled=!ready || Boolean(active);
    connect.textContent=ready ? "刷新模型" : "连接本机";
    hint.textContent=ready ? "对话由所选本地模型处理，记录保存在当前浏览器。"
      : "先启动本机 Ollama 并下载一个对话模型，再点击连接本机。";
  }
  function renderThreads() {
    const rows=order();
    if(!chats.has(current.id)) rows.unshift(current);
    threads.replaceChildren(...rows.map(chat=>{
      const item=element("button","thread",chat.title);
      item.title=chat.title;
      item.setAttribute("aria-pressed",String(chat.id===current.id));item.addEventListener("click",()=>select(chat));
      return item;
    }));
  }
  function updateForm() {
    const chat=chosen(), last=chat.messages.at(-1), writing=Boolean(active);
    retry.hidden=writing || !(last?.role==="assistant" && (last.state || "done")!=="done");
    retry.disabled=!ready;
    stop.hidden=!writing;send.hidden=writing;
    send.disabled=!ready || !initialized || !input.value.trim();
    model.disabled=!ready || writing; connect.disabled=Boolean(connecting) || writing;
    del.disabled=deleting || (writing && active.chat.id===chat.id);
    del.hidden=!chats.has(chat.id);
    del.textContent=checkingDelete?"确认删除":"删除会话";
  }
  function renderMessages(scroll=false) {
    const chat=chosen();title.textContent=chat.title;
    const nearEnd=messages.scrollHeight-messages.scrollTop-messages.clientHeight<75;
    const nodes=chat.messages.map((m,index)=>{
      const item=element("article","message");
      item.dataset.role=m.role;
      const author=element("strong","speaker",m.role==="user"?"你":"本地模型");
      const body=element("div","body",m.content);
      item.append(author,body);
      if(m.role==="assistant" && (m.state || "done")!=="done") {
        let label=m.state==="stopped" ? "已停止生成" : m.state==="error" ? m.error || "生成失败，可重新生成" : "上次生成已中断，可重新生成";
        if(m.state==="streaming" && active?.chat.id===chat.id && index===chat.messages.length-1) label="正在生成…";
        item.append(element("span","reply-state",label));
      }
      return item;
    });
    if(!nodes.length) nodes.push(element("p","empty","写下第一条提问，开始这次对话。"));
    messages.replaceChildren(...nodes);
    if(nearEnd || scroll) messages.scrollTop=messages.scrollHeight;
  }
  function render() { if(!mounted)return;renderThreads();renderMessages(true);updateForm(); }
  function storageChange(changes,area) {
    if(area!=="local") return;
    let changed=false;
    for(const [key,entry] of Object.entries(changes)) {
      if(key===modelKey && typeof entry.newValue==="string" && !active) {choice=entry.newValue;modelOptions();}
      if(!key.startsWith(prefix)) continue;
      const id=key.slice(prefix.length);
      if(valid(entry.newValue)) chats.set(id,entry.newValue); else chats.delete(id);
      if(!entry.newValue && current.id===id && !active) {current=order()[0] || fresh();input.value=drafts.get(current.id) || "";}
      changed=true;
    }
    if(changed) render();
  }
  async function persist(chat) {
    await storage.set({[prefix+chat.id]:chat});
    chats.set(chat.id,chat);
  }
  connect.addEventListener("click",async()=>{
    if(connecting || active)return;
    const controller=new AbortController(); connecting=controller;updateForm();notify("正在连接本机…");
    let timer;
    try {
      const allowed=await chrome.permissions.request({origins:[permission]});
      if(!allowed) throw new Error("需要允许晨屿访问 127.0.0.1 才能连接本地模型。");
      if(!mounted)return;
      timer=setTimeout(()=>controller.abort(),10000);
      const response=await fetch(base+"/api/tags",{signal:controller.signal,redirect:"error",credentials:"omit"});
      await checkResponse(response);
      const payload=await response.json();
      if(!Array.isArray(payload.models)) throw new Error("本机端口返回的内容不是 Ollama 的模型列表。");
      connectedModels=[...new Set(payload.models.map(m=>m?.name || m?.model).filter(m=>typeof m==="string" && m))];
      if(!connectedModels.length) throw new Error("本机还没有模型。请先在 Ollama 中下载模型，然后刷新。");
      notify("已连接本机模型。");
    } catch(error) {
      connectedModels=[];notify(error.name==="AbortError"?"连接超时，请检查本机 Ollama。":errorMessage(error));
    } finally {clearTimeout(timer);connecting=null;if(mounted){modelOptions();updateForm();}}
  });
  model.addEventListener("change",async()=>{
    choice=model.value;
    try {await storage.set({[modelKey]:choice});}catch{notify("模型选择未能保存。");}
  });
  add.addEventListener("click",async()=>{
    if(!initialized)return;
    if(!chats.has(current.id) && !current.messages.length && !input.value.trim()) {input.focus();return;}
    const next=fresh();
    try {await persist(next);select(next);input.focus();} catch {notify("无法新建对话，请检查本地存储。");}
  });
  del.addEventListener("click",async()=>{
    const id=current.id;
    if(!checkingDelete){checkingDelete=true;notify("此会话及其中的所有消息将从本机删除。");updateForm();return;}
    if(deleting)return;
    deleting=true;updateForm();
    try {
      await sessionLock(id,()=>storage.remove(prefix+id));chats.delete(id);drafts.delete(id);
      if(current.id===id)select(order()[0]||fresh());
      notify("已删除会话。");
    } catch(err){notify(errorMessage(err));}
    finally{deleting=false;checkingDelete=false;render();}
  });
  async function generate(isRetry) {
    if(active || !ready || !initialized)return;
    const prompt=input.value.trim(), original=current, selectedModel=model.value;
    if(!isRetry && !prompt)return;
    const run={chat:chosen(),controller:new AbortController()};
    active=run;updateForm();notify("");
    try {
      await sessionLock(original.id,async()=>{
        const key=prefix+original.id;
        const stored=(await storage.get(key))[key];
        if(!stored && original.messages.length) throw new Error("这个会话已在其他标签页删除。");
        const chat=structuredClone(valid(stored)?stored:original);
        if(isRetry) {
          const last=chat.messages.at(-1);
          if(last?.role!=="assistant" || (last.state || "done")==="done")throw new Error("这条回复已更新，请重新查看。");
          chat.messages.pop();
        } else {
          chat.messages.push({id:crypto.randomUUID(),role:"user",content:prompt,at:Date.now()});
          if(!chat.messages.some(m=>m.role==="assistant"))chat.title=Array.from(prompt).slice(0,24).join("");
        }
        const context=chat.messages.filter(m=>m.content).map(({role,content})=>({role,content}));
        const answer={id:crypto.randomUUID(),role:"assistant",content:"",state:"streaming",at:Date.now(),model:selectedModel};
        chat.messages.push(answer);chat.updated=Date.now();run.chat=chat;
        await persist(chat);
        if(!isRetry) { if(current.id===chat.id)input.value="";drafts.delete(chat.id); }
        render();
        let lastSaved=Date.now(),lastPaint=0,cache=Promise.resolve();
        try {
          const response=await fetch(base+"/api/chat",{
            method:"POST",headers:{"Content-Type":"application/json"},credentials:"omit",redirect:"error",
            body:JSON.stringify({model:selectedModel,messages:context,stream:true}),signal:run.controller.signal
          });
          await checkResponse(response);
          await readChunks(response,text=>{
            answer.content+=text;
            const now=Date.now();
            if(mounted && current.id===chat.id && now-lastPaint>45){renderMessages();lastPaint=now;}
            if(now-lastSaved>1500) {
              const snapshot=structuredClone(chat);
              cache=cache.then(()=>storage.set({[key]:snapshot})).catch(()=>{});
              lastSaved=now;
            }
          });
          if(!answer.content.trim()) throw new Error("模型返回了空回复。");
          answer.state="done";
        } catch(err) {
          answer.state=run.controller.signal.aborted?"stopped":"error";
          if(answer.state==="error")answer.error=errorMessage(err);
        } finally {
          await cache;chat.updated=Date.now();await persist(chat);
        }
      });
    } catch(err) {notify(errorMessage(err));}
    finally {if(active===run)active=null;render();}
  }
  stop.addEventListener("click",()=>active?.controller.abort());
  retry.addEventListener("click",()=>generate(true));
  form.addEventListener("submit",evt=>{evt.preventDefault();generate(false);});
  input.addEventListener("input",updateForm);
  input.addEventListener("keydown",evt=>{if(evt.key==="Enter" && (evt.ctrlKey||evt.metaKey) && !evt.isComposing){evt.preventDefault();generate(false);}});
  modelOptions();render();
  async function initialize() {
    if(!storage){notify("请在已加载的晨屿扩展中打开本地 AI。");return;}
    try {
      const values=await storage.get(null);
      if(!mounted)return;
      for(const [key,value] of Object.entries(values)) if(key.startsWith(prefix) && valid(value))chats.set(value.id,value);
      choice=values[modelKey]||"";initialized=true;modelOptions();
      select(chats.get(selectedId)||order()[0]||current);
      chrome.storage.onChanged.addListener(storageChange);
    } catch {notify("读取本机会话失败。");}
  }
  initialize();
  return ()=>{
    mounted=false;connecting?.abort();active?.controller.abort();
    if(storage)chrome.storage.onChanged.removeListener(storageChange);
    panel.remove();
  };
}
