import {deskNodes, fileSite, groupKey, moveNode, position, readDesk, watchDesk, webKey} from "./favorite-store.js";
import {button, groupForm, iconMark, make, pairForm, siteForm} from "./favorite-editor.js";
import {openDirectory} from "./directory.js";
export {favoriteAddress, findFavorite, saveFavorite} from "./favorite-store.js";

export function mountFavorites(root, {compact = false} = {}) {
  let perPage=Number(document.documentElement.dataset.iconsPerPage)||6;
  const box = make("div",compact ? "compact" : "panel");
  const grid = make("div","grid");
  const toolbar = make("div","toolbar");
  const homeTools = make("div","desk-tools");
  const actions = make("div","section-actions");
  const quickHost = compact && document.getElementById("quick-actions");
  const pager = make("nav","pager");
  pager.setAttribute("aria-label","收藏分页");
  const input = make("input","field");
  input.type = "search";
  input.placeholder = "搜索收藏名称或网址";
  input.setAttribute("aria-label","搜索个人收藏");
  const folders = make("select","filter");
  folders.setAttribute("aria-label","按分组筛选");
  const sort = make("select","filter");
  sort.setAttribute("aria-label","收藏排序");
  sort.append(new Option("自定义顺序","manual"),new Option("最近添加","recent"),new Option("按名称","title"));
  const status = make("p","message");
  status.setAttribute("role","status");
  let desk = {sites:[],folders:new Map(),newTab:true};
  let scope = "", page = 0, arranging = false, dragged = null;
  let generation = 0, alive = true, loaded = false;
  let homePage = 0;
  try { homePage = Math.max(0, Number(sessionStorage.getItem("daybreak.favoritePage")) || 0); } catch {}
  if (compact) page=homePage;

  let openedMenu = null;
  function closeMenu(focusTrigger = false) {
    if (!openedMenu) return;
    const {trigger,menu} = openedMenu;
    openedMenu = null;
    trigger.setAttribute("aria-expanded","false");
    menu.hidden = true;
    if (focusTrigger) trigger.focus();
  }
  function actionMenu(text, label, primary, choices) {
    const holder = make("div","menu-holder");
    const trigger = make("button",primary ? "menu-trigger favorites-menu-primary" : "menu-trigger",text);
    trigger.setAttribute("aria-label",label);
    trigger.setAttribute("aria-haspopup","menu");
    trigger.setAttribute("aria-expanded","false");
    const menu=make("div","menu");
    menu.setAttribute("role","menu");
    menu.setAttribute("aria-label",label);
    menu.id = "favorites-menu-" + crypto.randomUUID();
    trigger.setAttribute("aria-controls",menu.id);
    menu.hidden=true;
    function open(last = false) {
      closeMenu();
      menu.replaceChildren(...choices().map(({title,run,href})=>{
        const item=make(href ? "a" : "button","menu-item",title);
        if(href) item.href=href;
        item.tabIndex=-1;
        item.setAttribute("role","menuitem");
        item.addEventListener("click",()=>{
          closeMenu(true);
          run?.();
        });
        return item;
      }));
      menu.hidden=false;
      trigger.setAttribute("aria-expanded","true");
      openedMenu={holder,trigger,menu};
      (last ? menu.lastElementChild : menu.firstElementChild)?.focus();
    }
    trigger.addEventListener("click",()=>{openedMenu?.menu===menu ? closeMenu(true) : open();});
    trigger.addEventListener("keydown",event=>{
      if(event.key==="ArrowDown" || event.key==="ArrowUp") {event.preventDefault();open(event.key==="ArrowUp");}
    });
    menu.addEventListener("keydown",event=>{
      const items=[...menu.children], index=items.indexOf(document.activeElement);
      if(event.key==="Escape"){event.preventDefault();closeMenu(true);return;}
      if(event.key==="Tab"){closeMenu(true);return;}
      let next;
      if(event.key==="ArrowDown") next=(index+1)%items.length;
      else if(event.key==="ArrowUp") next=(index-1+items.length)%items.length;
      else if(event.key==="Home") next=0;
      else if(event.key==="End") next=items.length-1;
      else if(event.key===" " && document.activeElement?.tagName==="A"){
        event.preventDefault();document.activeElement.click();return;
      } else return;
      event.preventDefault();items[next]?.focus();
    });
    holder.append(trigger,menu);return holder;
  }
  function outside(event) { if(openedMenu && !openedMenu.holder.contains(event.target)) closeMenu(); }
  function routeChanged() { closeMenu(); }
  document.addEventListener("pointerdown",outside,true);
  document.addEventListener("focusin",outside);
  window.addEventListener("hashchange",routeChanged);

  function announce(message) { if(alive) status.textContent=message; }
  async function perform(action, message) {
    try { await action(); announce(message); await refresh(); }
    catch (error) { announce(error.message || "操作失败，请重试。"); }
  }
  function edit(record) {
    siteForm(box,record,desk,compact ? scope : folders.value,message=>{announce(message);refresh();});
  }
  function manage(name = "") {
    groupForm(box,name,(message,next)=>{
      announce(message);
      if (compact && name && scope===name) {scope=next;page=0;}
      if (!compact && name && folders.value===name) pendingFilter=next;
      refresh();
    });
  }
  function enter(name) {
    const previous=scope;
    if (!scope) homePage=page;
    scope=name;page=name ? 0 : homePage;
    show();
    if(name) homeTools.querySelector("button")?.focus();
    else [...grid.children].find(tile=>tile.dataset.nodeKey===groupKey(previous))?.querySelector("button")?.focus();
  }
  async function openAll(folder) {
    const sites = deskNodes(desk,folder).map(node=>node.site);
    if (!sites.length) return;
    let count=0;
    try {
      for (const site of sites) {
        if (globalThis.chrome?.tabs?.create) await chrome.tabs.create({url:site.url,active:false});
        else window.open(site.url,"_blank","noopener,noreferrer");
        count++;
      }
      announce("已打开 " + count + " 个网页");
    } catch { announce("已打开 " + count + " 个网页，部分标签页打开失败。"); }
  }
  function setLink(anchor,site) {
    anchor.href=site.url;
    anchor.target=desk.newTab ? "_blank" : "_self";
    anchor.rel="noopener noreferrer";
    anchor.title=site.title+" · "+new URL(site.url).hostname;
  }
  function siteTile(site) {
    const tile=make("div","tile");
    tile.dataset.nodeKey=webKey(site.url);
    const anchor=make("a","link");
    setLink(anchor,site);
    anchor.draggable=false;
    const copy=make("span","copy");
    copy.append(make("span","name",site.title));
    if (!compact) {
      const details=make("span","meta");
      details.append(make("span","domain",new URL(site.url).hostname));
      if (site.folder) details.append(make("span","folder",site.folder));
      copy.append(details);
    }
    anchor.append(iconMark(site),copy);
    tile.append(anchor);
    if (!compact) {
      const editButton=button("edit","编辑",()=>edit(site));
      editButton.setAttribute("aria-label","编辑收藏 "+site.title);
      tile.append(editButton);
    }
    return tile;
  }
  function folderTile(node) {
    const tile=make("div","tile");
    const open=button("folder-tile","",()=>enter(node.title));
    const contents=deskNodes(desk,node.title);
    open.setAttribute("aria-label","打开文件夹 "+node.title+"，"+contents.length+" 个网页");
    const mosaic=make("span","mosaic");
    mosaic.setAttribute("aria-hidden","true");
    for(const item of contents.slice(0,4)) mosaic.append(iconMark(item.site,true));
    if (!contents.length) mosaic.append(make("span","empty-folder-mark"));
    open.append(mosaic,make("span","name",node.title));
    tile.append(open);
    return tile;
  }
  function reorder(source,target,after) {
    if (!source || !target) return;
    const offset=deskNodes(desk,scope).findIndex(node=>node.key===target);
    if(offset>=0) page=Math.floor(offset/perPage);
    perform(()=>moveNode(source,target,scope,after),"已更新顺序");
  }
  function moveToFolder(node,folder) {
    if (!node?.site) return;
    perform(()=>fileSite(node.site.url,folder),folder ? "已移入「"+folder+"」" : "已移回首页");
  }
  function dropOn(target,handle,describe) {
    target.addEventListener("dragover",event=>{
      if(!dragged) return;
      event.preventDefault(); event.dataTransfer.dropEffect="move"; target.classList.add("favorites-drop-target");
      if(describe) target.dataset.dropHint=describe(dragged,event);
    });
    target.addEventListener("dragleave",event=>{ if(!target.contains(event.relatedTarget)) target.classList.remove("favorites-drop-target"); });
    target.addEventListener("drop",event=>{
      if(!dragged) return;
      event.preventDefault();event.stopPropagation();
      target.classList.remove("favorites-drop-target");
      const source=dragged;dragged=null;
      handle(source,event);
    });
  }
  function deskTile(node,index,nodes) {
    const tile=node.site ? siteTile(node.site) : folderTile(node);
    tile.draggable=true;
    tile.dataset.nodeKey=node.key;
    tile.addEventListener("dragstart",event=>{
      dragged=node;
      event.dataTransfer.setData("application/x-daybreak-shortcut",node.key);
      event.dataTransfer.effectAllowed="move";
    });
    tile.addEventListener("dragend",()=>{dragged=null;box.querySelectorAll(".favorites-drop-target").forEach(el=>el.classList.remove("favorites-drop-target"));});
    tile.addEventListener("contextmenu",event=>{event.preventDefault();node.site ? edit(node.site) : manage(node.title);});
    function positionAt(event) {
      const bounds=tile.getBoundingClientRect();
      const ratio=bounds.width ? (event.clientX-bounds.left)/bounds.width : .5;
      return ratio<.25 ? "before" : ratio>.75 ? "after" : "center";
    }
    dropOn(tile,(source,event)=>{
      if(source.key===node.key) return;
      const position=positionAt(event);
      if (position==="center" && node.folder && source.site) moveToFolder(source,node.title);
      else if(position==="center" && !scope && node.site && source.site) {
        pairForm(box,node.site,source.site,desk,message=>{announce(message);refresh();});
      } else reorder(source.key,node.key,position!=="before");
    },(source,event)=>{
      if(source.key===node.key) return "";
      const position=positionAt(event);
      if(position==="center" && source.site && node.folder) return "移入文件夹";
      if(position==="center" && !scope && source.site && node.site) return "合并为文件夹";
      return position==="before" ? "移到前面" : "移到后面";
    });
    if(arranging) {
      const controls=make("div","arrange-controls");
      const prev=button("step","‹",()=>reorder(node.key,nodes[index-1]?.key,false));
      const next=button("step","›",()=>reorder(node.key,nodes[index+1]?.key,true));
      const configure=button("step","编辑",()=>node.site ? edit(node.site) : manage(node.title));
      prev.setAttribute("aria-label","前移 "+node.title);
      next.setAttribute("aria-label","后移 "+node.title);
      configure.setAttribute("aria-label",(node.site ? "编辑收藏 " : "管理文件夹 ")+node.title);
      prev.disabled=index===0;next.disabled=index===nodes.length-1;
      controls.append(prev,next,configure);
      tile.append(controls);
    }
    return tile;
  }
  function homeView() {
    if(scope && !desk.folders.has(scope)) {scope="";page=homePage;}
    const nodes=deskNodes(desk,scope);
    const pages=Math.max(1,Math.ceil(nodes.length/perPage));
    page=Math.max(0,Math.min(Math.floor(page),pages-1));
    if(!scope) {
      homePage=page;
      try { sessionStorage.setItem("daybreak.favoritePage",String(page)); } catch {}
    }
    const controls=[];
    if(scope) {
      const back=button("desk-back","← 首页",()=>enter(""));
      dropOn(back,node=>moveToFolder(node,""));
      controls.push(back,make("strong","current-folder",scope));
    }
    homeTools.replaceChildren(...controls);
    homeTools.hidden=!controls.length;
    const start=page*perPage;
    const cards=nodes.slice(start,start+perPage).map((node,i)=>deskTile(node,start+i,nodes));
    if(!nodes.length) cards.push(make("p","desk-empty",scope
      ? "这个文件夹还没有网站。点「添加」放入第一个网页。"
      : "点「添加」收藏常用网站，也可以在浏览网页时使用晨屿工具栏按钮。"));
    grid.replaceChildren(...cards);
    pager.hidden=pages<2;
    if(pages>1) {
      function change(direction) {
        page+=direction;show();
        const links=[...pager.querySelectorAll("button")];
        (links[direction>0?1:0]?.disabled ? links[direction>0?0:1] : links[direction>0?1:0])?.focus();
      }
      const prev=button("page-step","上一页",()=>change(-1));
      const next=button("page-step","下一页",()=>change(1));
      prev.disabled=page===0;next.disabled=page===pages-1;
      if(!prev.disabled) dropOn(prev,node=>reorder(node.key,nodes[(page-1)*perPage].key,false));
      if(!next.disabled) dropOn(next,node=>reorder(node.key,nodes[Math.min(nodes.length-1,(page+2)*perPage-1)].key,true));
      pager.replaceChildren(prev,make("span","page-count",(page+1)+" / "+pages),next);
    } else pager.replaceChildren();
  }
  let pendingFilter = null;
  function fullView() {
    const needle=input.value.trim().toLocaleLowerCase();
    const visible=desk.sites.filter(item=>(!folders.value || item.folder===folders.value) &&
      (!needle || [item.title,item.url,item.folder].some(value=>value.toLocaleLowerCase().includes(needle))));
    visible.sort((a,b)=>{
      if(sort.value==="title") return a.title.localeCompare(b.title,"zh-CN") || a.url.localeCompare(b.url);
      return (sort.value==="recent" ? b.created-a.created : position(a)-position(b)) || a.url.localeCompare(b.url);
    });
    const cards=visible.map(siteTile);
    if(!cards.length) cards.push(make("p","empty",needle ? "没有匹配的收藏，试试其他名称或网址。"
      : folders.value ? "这个文件夹还没有网站。点「添加收藏」放入网页。" : "常用网站会收在这里。点「添加收藏」保存第一个网页。"));
    grid.replaceChildren(...cards);
    const tools=[];
    if(folders.value) {
      const current=folders.value;
      tools.push(button("desk-action","管理文件夹",()=>manage(current)));
      const size=desk.sites.filter(item=>item.folder===current).length;
      if(size) tools.push(button("desk-action","打开全部（"+size+"）",()=>openAll(current)));
    }
    homeTools.replaceChildren(...tools);homeTools.hidden=!tools.length;
  }
  function show() {
    const focus=document.activeElement;
    const oldTile=grid.contains(focus) ? focus?.closest("[data-node-key]") : null;
    const aria=focus?.getAttribute("aria-label");
    compact ? homeView() : fullView();
    if(oldTile && !focus.isConnected) {
      const replacement=[...grid.children].find(tile=>tile.dataset.nodeKey===oldTile.dataset.nodeKey);
      const controls=replacement ? [...replacement.querySelectorAll("button:not(:disabled),a[href]")] : [];
      (controls.find(item=>item.getAttribute("aria-label")===aria) || controls[0] || actions.querySelector("button"))?.focus();
    }
  }
  async function refresh() {
    const request=++generation;
    try {
      const state=await readDesk();
      if(!alive || request!==generation) return;
      desk=state;
      loaded=true;
      if(!compact) {
        const current=pendingFilter ?? folders.value;
        pendingFilter=null;
        const labels=[...desk.folders.keys()].sort((a,b)=>a.localeCompare(b,"zh-CN"));
        folders.replaceChildren(new Option("所有分组",""),...labels.map(name=>new Option(name,name)));
        if(desk.folders.has(current)) folders.value=current;
      }
      show();
    } catch {
      if(alive && request===generation) announce("无法读取收藏，请检查本地存储。");
    }
  }
  function organize(event) {
    if(!compact) return;
    scope=desk.folders.has(event.detail?.folder) ? event.detail.folder : "";
    page=0;arranging=true;show();
    requestAnimationFrame(()=>actions.querySelector("button[aria-label='管理收藏']")?.focus());
  }
  const manager=actionMenu("管理","管理收藏",false,()=>{
    const items=[];
    if(desk.sites.length || desk.folders.size) items.push({title:compact && arranging ? "完成整理" : "整理首页图标",run:()=>{
      if(compact){arranging=!arranging;show();}
      else {
        location.hash="home";
        window.dispatchEvent(new CustomEvent("daybreak-arrange-favorites",{detail:{folder:folders.value}}));
      }
    }});
    items.push({title:"新建文件夹",run:()=>manage()});
    if(compact && scope) {
      items.push({title:"管理当前文件夹",run:()=>manage(scope)});
      const count=desk.sites.filter(item=>item.folder===scope).length;
      if(count) items.push({title:"打开全部（"+count+"）",run:()=>openAll(scope)});
    }
    if(compact) items.push({title:"打开收藏页",href:"#favorites"});
    return items;
  });
  if(compact) {
    const add=actionMenu("添加","添加收藏",true,()=>[
      {title:"手动添加网址",run:()=>edit(null)},
      {title:"从网站目录添加",run:()=>openDirectory(scope)}
    ]);
    actions.append(add,manager);
    if(quickHost) quickHost.append(actions);
    else box.append(actions);
    window.addEventListener("daybreak-arrange-favorites",organize);
  } else {
    input.addEventListener("input",show);
    folders.addEventListener("change",show);
    sort.addEventListener("change",show);
    actions.append(button("primary","添加收藏",()=>edit(null)),manager);
    toolbar.append(input,folders,sort,actions);
    box.append(toolbar);
  }
  box.append(homeTools,grid,pager,status);
  root.replaceChildren(box);
  const stop=watchDesk(refresh);
  function resizePage(){
    perPage=Number(document.documentElement.dataset.iconsPerPage)||6;
    if(loaded)show();
  }
  if(compact) window.addEventListener("daybreak-icon-layout",resizePage);
  refresh();
  return ()=>{
    alive=false;stop();closeMenu();
    for(const [name,handler] of [["daybreak-icon-layout",resizePage],["daybreak-arrange-favorites",organize],["hashchange",routeChanged]]) window.removeEventListener(name,handler);
    document.removeEventListener("pointerdown",outside,true);document.removeEventListener("focusin",outside);
    actions.remove();box.remove();
  };
}
