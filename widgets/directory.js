import {readDesk, saveFavorite, watchDesk} from "./favorite-store.js";
import {el} from "./home.js";

const sites=[
  ["查资料","维基百科","https://zh.wikipedia.org/","W","#48646a"],
  ["查资料","中国知网","https://www.cnki.net/","知","#375d8d"],
  ["查资料","Google 学术","https://scholar.google.com/","G","#5477a4"],
  ["查资料","百度百科","https://baike.baidu.com/","百","#536ea4"],
  ["开发","GitHub","https://github.com/","GH","#384541"],
  ["开发","Gitee","https://gitee.com/","G","#963d3a"],
  ["开发","MDN","https://developer.mozilla.org/zh-CN/","M","#386c66"],
  ["开发","Stack Overflow","https://stackoverflow.com/","S","#966332"],
  ["日常","哔哩哔哩","https://www.bilibili.com/","哔","#9c5776"],
  ["日常","知乎","https://www.zhihu.com/","知","#365f9e"],
  ["日常","豆瓣","https://www.douban.com/","豆","#41734c"],
  ["日常","高德地图","https://www.amap.com/","图","#507765"],
  ["工具","DeepL","https://www.deepl.com/translator","D","#3a647c"],
  ["工具","腾讯文档","https://docs.qq.com/","文","#4f6395"],
  ["工具","飞书","https://www.feishu.cn/","飞","#366b85"],
  ["工具","中国天气网","https://www.weather.com.cn/","天","#417985"]
].map(([category,title,url,iconText,iconColor])=>({category,title,url,iconText,iconColor,folder:""}));

let nextFolder = "";
export function openDirectory(folder = "") {
  nextFolder = folder;
  location.hash = "directory";
}

export function mountDirectory(root){
  const folder = nextFolder;
  nextFolder = "";
  const box=el("section",null,"settings-card"),bar=el("div",null,"tool-bar");
  const input=el("input"), group=el("select"), tiles=el("div",null,"catalog-grid"), status=el("p","","tool-status");
  input.className=group.className="settings-field";input.type="search";input.placeholder="搜索网站名称或网址";input.setAttribute("aria-label","搜索网站目录");
  group.setAttribute("aria-label","网站分类");group.append(new Option("全部分类",""),...Array.from(new Set(sites.map(s=>s.category)),name=>new Option(name,name)));
  const bookmarks=el("option","浏览器里的书签");bookmarks.value="bookmarks";group.append(bookmarks);
  status.setAttribute("role","status");
  if(folder) status.textContent="添加到「"+folder+"」";
  bar.append(input,group);box.append(bar,status,tiles);root.replaceChildren(box);
  let saved=new Set(),live=true,native=[],version=0,request=0;
  async function collectBookmarks(){
    const tree=await chrome.bookmarks.getTree();
    const flatten=nodes=>nodes.flatMap(n=>n.url?( /^https?:\/\//i.test(n.url)?[{url:n.url,title:n.title||n.url,folder:"",category:"浏览器书签"}]:[]):flatten(n.children||[]));
    return [...new Map(flatten(tree).map(o=>[o.url,o])).values()];
  }
  let pageSize=60;
  function draw(){
    if(!live)return;
    const filter=input.value.trim().toLowerCase(),nativeMode=group.value==="bookmarks";
    const items=(nativeMode?native:sites).filter(item=>(nativeMode || !group.value || group.value===item.category) && (item.title+" "+item.url).toLowerCase().includes(filter));
    const cards=items.slice(0,pageSize).map(item=>{
      const entry=el("article",null,"catalog-item");
      const label=el("span",item.iconText||Array.from(item.title)[0],"catalog-mark"); if(item.iconColor)label.style.backgroundColor=item.iconColor;
      const info=el("div"),link=el("a",item.title);link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";
      info.append(link,el("small",new URL(item.url).hostname)); const url=new URL(item.url).href;
      const add=el("button",saved.has(url)?"已添加":"添加","tool-button");add.type="button";add.disabled=saved.has(url);add.setAttribute("aria-label",(add.disabled?"已添加 ":"添加 ")+item.title);
      add.addEventListener("click",async()=>{
        add.disabled=true;
        try{
          if(folder && !(await readDesk()).folders.has(folder)) throw new Error("原文件夹已移除，请返回收藏选择其他位置。");
          await saveFavorite({...item,folder});
          saved.add(url);status.textContent="已添加到"+(folder?"「"+folder+"」":"首页")+" · "+item.title;draw();
        }
        catch(e){status.textContent=e.message||"添加失败";await refresh();}
      });
      entry.append(label,info,add);return entry;
    });
    if(items.length>pageSize){
      const more=el("button","显示更多","tool-button");more.addEventListener("click",()=>{pageSize+=60;draw();});cards.push(more);
    }
    tiles.replaceChildren(...(cards.length?cards:[el("p","没有匹配的网站。","tool-status")]));
  }
  async function refresh(){const id=++version;const data=await readDesk();if(live && id===version){saved=new Set(data.sites.map(s=>s.url));draw();}}
  input.addEventListener("input",()=>{pageSize=60;draw();});
  group.addEventListener("change",async()=>{
    const id=++request;pageSize=60;
    if(group.value==="bookmarks"){
      try{const all=await collectBookmarks();if(id!==request||!live)return;native=all;}
      catch{status.textContent="读取浏览器书签失败。";}
    }
    draw();
  });
  const stop=watchDesk(()=>refresh().catch(()=>{}));draw();refresh().catch(()=>{});
  return ()=>{live=false;stop();box.remove();};
}
