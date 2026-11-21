import {backupRecords, restoreRecords} from "./backup.js";

const autoKey="daybreak.backup.daily";
const alarmName="daybreak.local-backup";
let opening;
function db(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open("daybreak-recovery",2);
    request.onupgradeneeded=()=>{
      const store=request.result.objectStoreNames.contains("snapshots")
        ? request.transaction.objectStore("snapshots") : request.result.createObjectStore("snapshots",{keyPath:"id"});
      store.createIndex("byTime",["time","kind","id"]);
    };
    request.onsuccess=()=>{const database=request.result;database.onversionchange=()=>{database.close();opening=null;};resolve(database);};
    request.onerror=()=>{opening=null;reject(request.error);};
  });
  return opening;
}
async function all(){
  const database=await db();
  return new Promise((resolve,reject)=>{
    const entries=[],request=database.transaction("snapshots").objectStore("snapshots").index("byTime").openKeyCursor(null,"prev");
    request.onsuccess=()=>{
      const cursor=request.result;
      if(!cursor){resolve(entries);return;}
      const [time,kind,id]=cursor.key; entries.push({id,kind,time});cursor.continue();
    };
    request.onerror=()=>reject(request.error);
  });
}
function localDay(time){
  const date=new Date(time);
  return [date.getFullYear(),date.getMonth()+1,date.getDate()].join("-");
}
async function saveSnapshot(kind){
  const records=await backupRecords(),database=await db();
  const time=Date.now(), id=kind==="auto"?"auto-"+localDay(time):crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction("snapshots","readwrite"),store=tx.objectStore("snapshots");
    store.put({id,kind,time,records});
    const req=store.index("byTime").openKeyCursor(null,"prev");
    let retained=0;
    req.onsuccess=()=>{
      const cursor=req.result;
      if(!cursor)return;
      if(cursor.key[1]===kind && ++retained>3)store.delete(cursor.primaryKey);
      cursor.continue();
    };
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("未能保存还原点"));
  });
}
export function listenForDailyBackup(){
  const local=chrome.storage.local;
  async function schedule(){
    if((await local.get(autoKey))[autoKey]===true){
      if(!await chrome.alarms.get(alarmName))await chrome.alarms.create(alarmName,{delayInMinutes:1});
    }else await chrome.alarms.clear(alarmName);
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==="local" && Object.keys(changes).some(k=>k.startsWith("daybreak.")&&!k.startsWith("daybreak.runtime.")&&k!=="daybreak.weather.forecast"))schedule().catch(()=>{});
  });
  chrome.alarms.onAlarm.addListener(async alarm=>{
    if(alarm.name===alarmName && (await local.get(autoKey))[autoKey]===true){
      try{await saveSnapshot("auto");await local.remove("daybreak.runtime.backupError");}
      catch{await local.set({"daybreak.runtime.backupError":"定时备份未能写入本机，请检查剩余空间。"});}
    }
  });
}
export function mountSnapshots(root){
  root.innerHTML='<h2>本机还原点</h2><p class="tool-status">手动、自动各保留最近三个还原点。自动备份会在当天有改动后更新。</p><label class="settings-row"><span>按天自动备份</span><input class="settings-switch" type="checkbox" role="switch"></label><button type="button" class="tool-button">创建还原点</button><p class="tool-status" role="status"></p><div class="snapshot-list"></div>';
  const checkbox=root.querySelector("input"), create=root.querySelector("button"), status=root.querySelector('[role="status"]'),list=root.querySelector(".snapshot-list");
  let generation=0;
  async function refresh(){
    const n=++generation;
    try{
      const [items,config]=await Promise.all([all(),chrome.storage.local.get([autoKey,"daybreak.runtime.backupError"])]);
      if(n!==generation)return;
      checkbox.checked=config[autoKey]===true;
      if(config["daybreak.runtime.backupError"])status.textContent=config["daybreak.runtime.backupError"];
      list.replaceChildren(...items.map(item=>{
        const row=document.createElement("div");row.className="settings-row";
        const title=document.createElement("span");title.textContent=(item.kind==="auto"?"自动 · ":"手动 · ")+new Date(item.time).toLocaleString("zh-CN");
        const restore=document.createElement("button");restore.type="button";restore.className="tool-button";restore.textContent="恢复";
        restore.addEventListener("click",async()=>{
          if(!window.confirm("用此还原点替换晨屿当前的个人数据？浏览器书签和历史由浏览器单独保存。"))return;
          restore.disabled=true;
          try{
            const database=await db();
            const saved=await new Promise((resolve,reject)=>{
              const request=database.transaction("snapshots").objectStore("snapshots").get(item.id);
              request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
            });
            if(!saved || saved.time!==item.time){status.textContent="还原点已更新，请重新选择。";await refresh();return;}
            await restoreRecords(saved.records,"replace");status.textContent="已恢复还原点。";await refresh();
          }
          catch{status.textContent="恢复失败，请重试。";restore.disabled=false;}
        });
        row.append(title,restore);return row;
      }));
    }catch{status.textContent="无法读取本机还原点。";}
  }
  checkbox.addEventListener("change",async()=>{
    try {await chrome.storage.local.set({[autoKey]:checkbox.checked});}
    catch{status.textContent="设置保存失败。";await refresh();}
  });
  create.addEventListener("click",async()=>{
    create.disabled=true;
    try{await saveSnapshot("manual");status.textContent="已创建还原点。";await refresh();}
    catch{status.textContent="还原点保存失败，请检查剩余空间。";}
    finally{create.disabled=false;}
  });
  // Restore records are intentionally kept outside exported data and survive an in-app restore.
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&document.body.dataset.route==="settings")refresh();});
  window.addEventListener("hashchange",()=>{if(document.body.dataset.route==="settings")refresh();});
  refresh();
}
