import "./worker.js";
import {listenForDailyBackup} from "./widgets/snapshots.js";
listenForDailyBackup();

const mailAlarm = "daybreak.gmail.check";
const stateKey = "daybreak.runtime.mail";
const permission = {origins:["https://mail.google.com/*"]};
async function enabled(){
  return (await chrome.storage.local.get("daybreak.mail.enabled"))["daybreak.mail.enabled"] === true && await chrome.permissions.contains(permission);
}
let checking;
async function checkMail(){
  if(!await enabled())return;
  const previous=(await chrome.storage.local.get(stateKey))[stateKey];
  try{
    const response=await fetch("https://mail.google.com/mail/feed/atom",{credentials:"include",cache:"no-store",signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error();
    const xml=await response.text();
    const count=/<fullcount\b[^>]*>\s*(\d+)\s*<\/fullcount>/i.exec(xml);
    if(!count || !/<feed\b/i.test(xml))throw new Error();
    if(!await enabled())return;
    const n=Number(count[1]);
    await chrome.storage.local.set({[stateKey]:{count:n,time:Date.now()}});
    const notify=(await chrome.storage.local.get("daybreak.mail.notify"))["daybreak.mail.notify"];
    if(notify && Number.isFinite(previous?.count) && n>previous.count && await chrome.permissions.contains({permissions:["notifications"]})){
      await chrome.notifications.create("daybreak-gmail",{type:"basic",iconUrl:"assets/icon128.png",title:"Gmail 有新邮件",message:"收件箱现有 "+n+" 封未读邮件。"});
    }
  } catch {
    if(await enabled()){
      await chrome.storage.local.set({[stateKey]:{error:"无法读取收件箱。请确认 Workspace 邮箱已登录，并允许读取 Gmail 收件箱 Feed。",time:Date.now()}});
    }
  }
}
function refreshMail(){
  if(!checking)checking=checkMail().finally(()=>{checking=null;});
  return checking;
}
async function scheduleMail(){
  if(await enabled()){
    if(!await chrome.alarms.get(mailAlarm))await chrome.alarms.create(mailAlarm,{periodInMinutes:5});
    await refreshMail();
  }else{
    await chrome.alarms.clear(mailAlarm);await chrome.storage.local.remove(stateKey);
  }
}
chrome.runtime.onInstalled.addListener(scheduleMail);
chrome.runtime.onStartup.addListener(scheduleMail);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local" && changes["daybreak.mail.enabled"])scheduleMail();});
chrome.permissions.onRemoved.addListener(removed=>{if(removed.origins?.includes(permission.origins[0]))chrome.storage.local.set({"daybreak.mail.enabled":false,"daybreak.mail.notify":false});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===mailAlarm)refreshMail();});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=="mail-check"||sender.id!==chrome.runtime.id)return;
  refreshMail().then(()=>reply(true),()=>reply(false));return true;
});
