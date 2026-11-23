const prefix = "daybreak.layout.";
const defaults = {
  mode: "dashboard", clock: true, search: true, labels: true,
  iconSize: 54, iconRadius: 15, iconOpacity: 100, columns:6, rows:1,
  iconShadow:false, textShadow:true, fontSize:13, fontFace:"system",labelColor:"auto",
  searchWidth:574, searchRadius:10,searchOpacity:100,searchShadow:true,homeScale:100,sideScale:100,
  bookmarkBar: false, frequentBar: false, linksNewTab: true, bookmarksNewTab: true, historyNewTab: true
};
const ranges = { iconSize: [34, 104], iconRadius: [0, 52], iconOpacity: [25, 100], columns:[2,8], rows:[1,6],
  fontSize:[10,22],searchWidth:[285,900],searchRadius:[0,32],searchOpacity:[35,100],homeScale:[75,130],sideScale:[75,130] };
const modes = { dashboard:"工作台", classic:"经典图标", minimal:"极简" };
const selections = {mode:modes,fontFace:{system:"系统字体",serif:"衬线",mono:"等宽"},labelColor:{auto:"跟随主题",light:"米白",dark:"墨绿",gold:"琥珀"}};
const keys = Object.keys(defaults).map(key => prefix + key);
const storage = globalThis.chrome?.storage;

export function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function layoutValues(raw) {
  const result = { ...defaults };
  for (const [key, initial] of Object.entries(defaults)) {
    const value = raw[prefix + key];
    if (typeof value !== typeof initial) continue;
    if (selections[key] && !Object.hasOwn(selections[key],value)) continue;
    if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1])) continue;
    result[key] = value;
  }
  return result;
}
async function loadLayout() {
  if (storage) return layoutValues(await storage.local.get(keys));
  const raw = {};
  for (const key of keys) { try { raw[key] = JSON.parse(localStorage.getItem(key)); } catch {} }
  return layoutValues(raw);
}
export function mountLayout(root, apply) {
  const fields = new Map();
  const status = el("p","","settings-status");
  status.setAttribute("role","status");
  function section(title) {
    const item = el("section",null,"settings-card");
    item.append(el("h2", title));
    root.append(item);
    return item;
  }
  const layout = section("首页布局");
  const opening = section("链接打开方式");
  const appearance = el("details",null,"layout-appearance");
  appearance.append(el("summary","更多外观设置"));layout.append(appearance);
  let state = {...defaults};
  function show(values) {
    state = values;
    for (const [key, node] of fields) {
      if (node.type === "checkbox") node.checked = values[key];
      else node.value = values[key];
      if (node.type === "range") node.nextElementSibling.textContent = values[key] + ({iconOpacity:"%",iconSize:" px",iconRadius:" px",fontSize:" px",searchWidth:" px",searchRadius:" px",searchOpacity:"%",homeScale:"%",sideScale:"%"}[key] || "");
    }
    const style = document.documentElement.style;
    style.setProperty("--daybreak-icon-size",values.iconSize + "px");
    style.setProperty("--daybreak-icon-radius",values.iconRadius + "px");
    style.setProperty("--daybreak-icon-opacity",String(values.iconOpacity / 100));
    style.setProperty("--daybreak-icon-label-display",values.labels ? "block" : "none");
    style.setProperty("--daybreak-icon-columns",String(values.columns));
    for(const [variable,value] of Object.entries({
      "--icon-shadow":values.iconShadow?"0 3px 10px #15261855":"none",
      "--label-shadow":values.textShadow?"0 1px 4px #15221899":"none",
      "--label-size":values.fontSize+"px","--label-font":{system:"inherit",serif:"Georgia, SimSun, serif",mono:"Consolas, monospace"}[values.fontFace],
      "--search-width":values.searchWidth+"px","--search-radius":values.searchRadius+"px","--search-alpha":values.searchOpacity/100,
      "--search-shadow":values.searchShadow?"0 2px 10px #12231835":"none","--home-zoom":values.homeScale/100,"--side-zoom":values.sideScale/100
    }))style.setProperty(variable,String(value));
    if(values.labelColor==="auto")style.removeProperty("--label-color");
    else style.setProperty("--label-color",{dark:"#234b39",light:"#fffdf1",gold:"#e7bf6c"}[values.labelColor]);
    const pageSize = Math.round(values.rows)*Math.round(values.columns);
    if(document.documentElement.dataset.iconsPerPage!==String(pageSize)){
      document.documentElement.dataset.iconsPerPage=String(pageSize);
      window.dispatchEvent(new Event("daybreak-icon-layout"));
    }
    document.body.dataset.homeLayout = values.mode;
    document.body.dataset.showClock = String(values.clock);
    document.body.dataset.showSearch = String(values.search);
    apply(values);
  }
  function field(card, key, label) {
    const row = el("label",null,"settings-row");
    const input = el(selections[key] ? "select" : "input");
    input.name = key;
    input.setAttribute("aria-label",label);
    const controls = el("span",null,"layout-control");
    row.append(el("span",label),controls);
    controls.append(input);
    if (selections[key]) {
      input.className = "settings-field";
      for (const [value,name] of Object.entries(selections[key])) input.append(new Option(name,value));
    } else if (ranges[key]) {
      input.type = "range";
      [input.min,input.max] = ranges[key];
      controls.append(el("output"));
    } else { input.type="checkbox"; input.className="settings-switch"; input.setAttribute("role","switch"); }
    fields.set(key,input);
    input.addEventListener("change",async () => {
      const value = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      try {
        if (key === "frequentBar" && value && (!chrome.permissions || !await chrome.permissions.request({permissions:["topSites"]}))) {
          show(state); status.textContent = "需要允许读取最常访问的网站才能显示这一栏。"; return;
        }
        if (storage) await storage.local.set({[prefix+key]:value});
        else localStorage.setItem(prefix + key,JSON.stringify(value));
        await refresh();
        status.textContent = "首页设置已保存。";
      } catch { show(state); status.textContent = "未能保存此设置。"; }
    });
    card.append(row);
  }
  for (const [key,label] of Object.entries({mode:"显示模式",clock:"显示时钟",search:"显示搜索框",bookmarkBar:"顶部显示书签",frequentBar:"顶部显示常用网站",labels:"显示图标名称",columns:"桌面收藏列数",rows:"每页收藏行数",iconSize:"图标大小",iconRadius:"图标圆角",iconOpacity:"图标不透明度"})) field(layout,key,label);
  for(const [key,label] of Object.entries({fontFace:"图标名称字体",fontSize:"图标名称字号",labelColor:"图标名称颜色",iconShadow:"图标阴影",textShadow:"经典布局文字阴影",searchWidth:"搜索框宽度",searchRadius:"搜索框圆角",searchOpacity:"搜索框不透明度",searchShadow:"搜索框阴影",homeScale:"首页内容缩放",sideScale:"侧边栏内容缩放"}))field(appearance,key,label);
  layout.append(appearance);
  for (const [key,label] of Object.entries({linksNewTab:"在新标签页打开收藏网站",bookmarksNewTab:"在新标签页打开书签",historyNewTab:"在新标签页打开历史记录"})) field(opening,key,label);
  root.append(status);
  let request=0;
  async function refresh() {
    const id=++request, values=await loadLayout();
    if (id === request) show(values);
  }
  storage?.onChanged.addListener((changes,area) => {
    if (area === "local" && Object.keys(changes).some(k => keys.includes(k))) refresh().catch(()=>{});
  });
  window.addEventListener("storage", event => { if (keys.includes(event.key) || event.key === null) refresh().catch(()=>{}); });
  refresh().catch(() => show(defaults));
}

export function setupQuickStrip(root) {
  let current = defaults, version=0;
  const row = (title, items, newTab) => {
    const block=el("div",null,"quick-strip-row");
    block.append(el("strong",title));
    for (const item of items) {
      if (!/^https?:\/\//i.test(item.url || "")) continue;
      const a=el("a",item.title || new URL(item.url).hostname);
      a.href=item.url; a.title=a.textContent + " · " + item.url;
      if (newTab) { a.target="_blank"; a.rel="noopener noreferrer"; }
      block.append(a);
    }
    if(block.childElementCount===1) block.append(el("span","暂无网页"));
    return block;
  };
  async function refresh() {
    const id=++version, values=current, rows=[];
    if (values.bookmarkBar && chrome.bookmarks) {
      try {
        const tree=await chrome.bookmarks.getTree(), children=tree[0]?.children || [];
        const toolbar=children.find(node=>node.folderType==="bookmarks-bar" || node.id==="1") || children[0];
        const collect=nodes=>nodes.flatMap(node=>node.url ? [node] : collect(node.children||[]));
        rows.push(row("书签栏",collect(toolbar?.children||[]),values.bookmarksNewTab));
      } catch { rows.push(row("书签栏",[],false)); }
    }
    if (values.frequentBar && chrome.topSites) {
      try { rows.push(row("常用网站",await chrome.topSites.get(),values.linksNewTab)); } catch {}
    }
    if(id!==version) return;
    root.replaceChildren(...rows);root.hidden=!rows.length;
  }
  for (const event of ["onCreated","onRemoved","onMoved","onChanged","onChildrenReordered","onImportEnded"]) globalThis.chrome?.bookmarks?.[event]?.addListener(()=>{if(current.bookmarkBar) refresh();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden && current.frequentBar) refresh();});
  return values=>{ current=values; refresh(); };
}

export function setupWidgetDrawer(dialog, container, drawIcon) {
  const content = dialog.querySelector("#drawer-content");
  let origin, activeCard;
  function restore() {
    if (!origin) return;
    origin.replaceWith(activeCard); origin=null; activeCard=null;
  }
  dialog.addEventListener("close",()=>{ if (!dialog.open) restore(); });
  dialog.querySelector(".drawer-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
  for (const [id,title,glyph] of [
    ["weather","天气","weather"], ["tasks","待办事项","check"], ["notes","笔记","note"],
    ["bookmarks","书签","bookmark"], ["history","历史记录","history"],
    ["settings","设置","settings"]
  ]) {
    const card=document.getElementById(id+"-card");
    const button=el(card?"button":"a",null,"system-tile");
    button.setAttribute("aria-label",title);button.dataset.module=id;
    const icon=el("span",null,"system-glyph");
    drawIcon(icon,glyph);
    button.append(icon,el("span",title,"system-label"));
    if(card) button.addEventListener("click",()=>{
      if(dialog.open) return;
      origin=document.createComment("widget"); activeCard=card; card.before(origin);
      content.append(card); dialog.setAttribute("aria-label",title);dialog.showModal();
    });
    else button.href="#"+id;
    container.append(button);
  }
  const taskTile=container.querySelector('[data-module="tasks"]');
  const badge=el("span","","shortcut-count");badge.hidden=true;taskTile.append(badge);
  document.addEventListener("daybreak-task-count",e=>{
    const n=Number(e.detail)||0;badge.hidden=n<=0;badge.textContent=n>99?"99+":String(n);
    taskTile.setAttribute("aria-label",n>0?"待办事项，"+n+" 项未完成":"待办事项");
  });
  return () => { if(dialog.open)dialog.close(); restore(); };
}
