"use strict";

const ui = {
  state: null,
  readerId: null,
  shelf: "saved",
  filters: {},
  drafts: new Map(),
  pending: new Set(),
  refreshPending: false,
  archiveQuery: "",
  usagePeriod: "today",
  related: new Map(),
};

const views = { today: "研究日报", press: "中文媒体报道", week: "本周趋势", archive: "收录记录", search: "相关搜索", library: "我的书架", sources: "信息来源", usage: "API 用量" };
const byId = (id) => document.getElementById(id);
const staticReader = document.documentElement.dataset.reader === "static";

function readOnlyWorkspace() {
  return staticReader || ui.state?.cloud_readonly === true || ui.state?.cloud_hosted === true;
}

function currentView() {
  const key = location.hash.slice(1);
  if (key === "usage" && readOnlyWorkspace()) return "today";
  return Object.hasOwn(views, key) ? key : "today";
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function icon(key) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#i-" + key);
  svg.append(use);
  return svg;
}

function button(label, fn, style = "secondary", iconName) {
  const b = node("button", "button " + style);
  b.type = "button";
  if (iconName) b.append(icon(iconName));
  b.append(document.createTextNode(label));
  b.addEventListener("click", fn);
  return b;
}

function external(url, label) {
  try {
    const target = new URL(url);
    if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) return null;
    const link = node("a", "button secondary", label);
    link.href = target.href;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.append(icon("external"));
    return link;
  } catch {
    return null;
  }
}

function empty(title, hint) {
  const box = node("div", "empty");
  box.append(node("strong", "", title));
  if (hint) box.append(node("p", "", hint));
  return box;
}

function heading(title, count) {
  const box = node("div", "section-heading");
  box.append(node("h2", "", title));
  if (count) box.append(node("span", "count", count));
  return box;
}

function notice(message, error = false) {
  const n = byId("notice");
  n.textContent = message;
  n.classList.toggle("error", error);
  n.hidden = !message;
}

function dateLabel(value) {
  if (!value) return "未记录";
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "未记录";
}

async function api(path, payload) {
  if (payload !== undefined && (!ui.state || readOnlyWorkspace())) {
    throw new Error("请在电脑工作台上编辑。");
  }
  let address = "/api/" + path;
  if (staticReader) {
    if (path.startsWith("search?")) {
      const params = new URLSearchParams(path.slice("search?".length));
      const {searchReading} = await import("./reader-search.mjs");
      return {items: searchReading(ui.state, [], params.get("q") || "", params.get("id") || "") || []};
    }
    if (path !== "state") throw new Error("此操作需要在电脑工作台上完成。");
    // A phone reload just after a desktop publish should read the new Pages snapshot.
    address = "./data/state.json?read=" + Date.now();
  }
  const options = payload === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  };
  const response = await fetch(address, options);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(staticReader ? "未能读取已发布的资料，请稍后重试。" : "服务返回了无法读取的内容，请检查本地服务。");
  }
  if (!response.ok || result.ok === false) {
    throw new Error(typeof result.error === "string" ? result.error : "请求未成功（" + response.status + "）。");
  }
  return result;
}

function getArticle(id) {
  return (ui.state?.articles || []).find((a) => a.id === id);
}

function findSource(id) {
  return (ui.state?.sources || []).find((s) => s.id === id);
}

async function reload() {
  const data = await api("state");
  if (!Array.isArray(data.articles) || !Array.isArray(data.sources)) {
    throw new Error("资料数据格式不完整。");
  }
  ui.state = data;
  ui.related.clear();
  render();
  if (byId("reader").open && getArticle(ui.readerId)) renderReader();
}

function navigate() {
  byId("nav-toggle").setAttribute("aria-expanded", "false");
  if (byId("reader").open) byId("reader").close();
  if (byId("importer").open) byId("importer").close();
  notice("");
  render();
  window.scrollTo({top: 0, behavior: "instant"});
}

function render() {
  const active = currentView();
  const readOnly = readOnlyWorkspace();
  const title = active === "library" && readOnly ? "研究笔记" : views[active];
  document.title = "PaperHunter · " + title;
  byId("view-title").textContent = title;
  for (const a of document.querySelectorAll("nav a")) {
    if (a.dataset.view === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (!ui.state) return;
  byId("open-import").hidden = readOnly;
  byId("refresh").hidden = readOnly;
  byId("reader-mode").hidden = !readOnly;
  document.querySelector('nav a[data-view="usage"]').hidden = readOnly;
  document.querySelector('nav a[data-view="library"]').lastChild.textContent = readOnly ? "研究笔记" : "我的书架";
  const today = ui.state.today;
  const edition = byId("daily-edition");
  edition.hidden = active !== "today" || (staticReader && !ui.state.edition_dates?.includes(today));
  edition.href = "./daily/" + today + ".html";
  const day = new Date(today + "T12:00:00+08:00");
  byId("calendar").textContent = Number.isNaN(day.getTime()) ? today :
    day.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const latest = ui.state.sources.map((s) => s.last_success).filter(Boolean).sort().at(-1);
  byId("last-sync").textContent = latest ? dateLabel(latest) : "尚无记录";
  const content = byId("content");
  content.replaceChildren();
  content.setAttribute("aria-busy", "false");
  if (active === "today") renderToday(content);
  if (active === "press") renderPress(content, true);
  if (active === "week") renderWeek(content);
  if (active === "library") renderLibrary(content);
  if (active === "sources") renderSources(content);
  if (active === "search") renderSearch(content);
  if (active === "archive") renderCatalogue(content, "archive", ui.state.articles);
  if (active === "usage") renderUsage(content);
}

function metadata(parts) {
  const line = node("div", "meta");
  for (const [text, className] of parts) {
    if (text) line.append(node("span", className || "", text));
  }
  return line;
}

function storyTitle(article) {
  const b = node("button", "title", article.title || article.url || "未命名条目");
  b.type = "button";
  b.addEventListener("click", () => openReader(article.id));
  return b;
}

function story(article, className) {
  const box = node("article", className);
  const title = node("h3");
  title.append(storyTitle(article));
  box.append(metadata([
    [article.topic, "topic"],
    [article.kind],
    [article.org],
    [article.published && "发布 " + dateLabel(article.published)],
    [!readOnlyWorkspace() && article.saved && "已收藏"],
    [!readOnlyWorkspace() && article.tracking && "跟踪中"],
    [!readOnlyWorkspace() && article.read && "已读"],
  ]), title);
  if (article.brief || article.summary) box.append(node("p", "summary", article.brief || article.summary));
  return box;
}

function observationLink(evidence) {
  const anchor = external(evidence.url, evidence.title || evidence.source || "来源原文");
  if (anchor) anchor.className = "citation";
  return anchor;
}

function renderOverview(parent) {
  const overview = ui.state.overview || {};
  const text = node("div", "editorial");
  const head = heading("今日热点");
  const analysis = typeof overview.analysis === "string" ? overview.analysis : "";
  text.append(head);
  const publicAnalysis = node("details", "analysis-sources");
  publicAnalysis.append(node("summary", "", "DeepSeek · 公开资料综合"));
  if (analysis || overview.lead) {
    if (overview.lead) text.append(node("p", "lead", overview.lead));
    if (analysis) {
      const refs = overview.analysis_evidence || [];
      const paragraph = node("p", "analysis");
      for (const fragment of analysis.split(/(\[\d+\])/g)) {
        const number = /^\[(\d+)\]$/.exec(fragment);
        const ref = number && refs[Number(number[1]) - 1];
        const link = ref && external(ref.url, fragment);
        if (link) {
          link.className = "inline-citation"; link.replaceChildren(fragment);
          link.setAttribute("aria-label", "引用 " + number[1] + "，" + ref.title);
          link.title = ref.title; paragraph.append(link);
        } else paragraph.append(fragment);
      }
      publicAnalysis.append(paragraph);
      if (refs.length) {
        const sources = node("details", "analysis-sources");
        sources.append(node("summary", "", "综述引用 · " + refs.length + " 篇"));
        const list = node("ol", "analysis-refs");
        for (const ref of refs) {
          const link = external(ref.url, ref.title);
          if (link) { link.className = "citation"; const entry = node("li"); entry.append(link); list.append(entry); }
        }
        sources.append(list); publicAnalysis.append(sources);
      }
    }
  } else {
    text.append(empty("当日综述待生成", "采集后可在这里查看有来源依据的研究进展。"));
  }
  for (const [index, topic] of (overview.topics || []).entries()) {
    const entry = node("details", "topic-brief");
    entry.open = index === 0;
    const title = node("summary");
    title.append(node("span", "event-title", topic.title));
    const count = new Set((topic.evidence || []).map(e => e.source)).size;
    const meta = [topic.category, count > 1 && count + " 个来源"].filter(Boolean).join(" · ");
    if (meta) title.append(node("small", "event-meta", meta));
    entry.append(title, node("p", "", topic.summary));
    const citations = node("ul", "citations");
    for (const ref of topic.evidence || []) {
      const link = observationLink(ref);
      if (link) {
        const li = node("li"); li.append(link);
        const origin = [ref.source, ref.event].filter(Boolean).join(" · ");
        if (origin) li.append(node("small", "origin", origin));
        citations.append(li);
      }
    }
    if (citations.children.length) entry.append(citations);
    text.append(entry);
  }
  if (analysis) text.append(publicAnalysis);
  if (overview.method) text.append(node("p", "editorial-method", overview.method));
  parent.append(text);
}

function dateFromISO(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(value || "") ? new Date(value.slice(0, 10) + "T12:00:00Z") : null;
}

function calendarGraphic(article, figure) {
  const published = dateFromISO(article.published);
  const collected = dateFromISO(article.first_seen);
  const reference = published || collected;
  const label = (article.kind === "论文" ? "论文" : "资料") + "信息图";
  figure.classList.add("date-cover");
  const canvas = node("canvas");
  canvas.width = 640; canvas.height = 264;
  const description = label + " · " + (published ? "发表 " + dateLabel(article.published) : "收录 " + dateLabel(article.first_seen));
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", article.title + " · " + description);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const palettes = [["#163f40", "#d3e9b7", "#8abbaa"], ["#32374e", "#f2c6a6", "#aa9aa3"], ["#614130", "#f7da94", "#c7a778"], ["#304d60", "#d5e4ed", "#9dbfb8"]];
    const key = Array.from(article.id || article.title || "").reduce((sum, ch) => sum + ch.codePointAt(0), 0);
    const [bg, ink, muted] = palettes[key % palettes.length];
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 640, 264);
    const day = reference ? reference.getUTCDate() : 0;
    const days = reference ? new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0)).getUTCDate() : 31;
    // The outer dial marks calendar days. The filled marker is the item's publication or collection day.
    const cx = 475, cy = 135;
    const point = (i, radius) => {
      const angle = (i / days) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    };
    ctx.strokeStyle = muted; ctx.fillStyle = muted; ctx.lineWidth = 1;
    for (const radius of [72, 93, 109]) {
      ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = .95;
    for (let i = 0; i < days; i++) {
      ctx.beginPath(); ctx.moveTo(...point(i, i % 5 === 0 ? 91 : 99)); ctx.lineTo(...point(i, 109)); ctx.stroke();
    }
    ctx.globalAlpha = .45;
    ctx.beginPath(); ctx.moveTo(cx - 133, cy); ctx.lineTo(cx + 133, cy);
    ctx.moveTo(cx, cy - 125); ctx.lineTo(cx, cy + 125); ctx.stroke();
    ctx.globalAlpha = 1;
    if (day) {
      ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...point(day - 1, 94)); ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(...point(day - 1, 94), 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = ink; ctx.font = "16px sans-serif";
    ctx.fillText(reference ? reference.toISOString().slice(0, 7).replace("-", " / ") : "日期待核", 33, 57);
    ctx.font = "100px Georgia, serif"; ctx.fillText(day ? String(day).padStart(2, "0") : "—", 28, 158);
    ctx.font = "19px sans-serif"; ctx.fillText(published ? "发表日" : "收录日", 36, 199);
    ctx.fillStyle = muted; ctx.font = "17px sans-serif";
    let title = "";
    for (const ch of article.title || "") {
      if (ctx.measureText(title + ch + "…").width > 275) { title += "…"; break; }
      title += ch;
    }
    ctx.fillText(title, 36, 234);
  }
  figure.append(canvas, node("figcaption", "", description));
}

function mediaAddress(value) {
  if (typeof value !== "string") return "";
  if (/^\/media\/[a-f0-9]{64}\.(?:jpe?g|png|gif|webp)$/i.test(value)) return "." + value;
  try {
    const remote = new URL(value);
    const hosts = ["cdn-thumbnails.huggingface.co", "i.ytimg.com", "images.ctfassets.net", "cdn.openai.com",
      "openai.com", "cdn.sanity.io", "www.anthropic.com", "deepmind.google", "lh3.googleusercontent.com"];
    return remote.protocol === "https:" && !remote.username && !remote.password && !remote.port && hosts.includes(remote.hostname) ? remote.href : "";
  } catch { return ""; }
}

function paperCover(article) {
  const figure = node("figure", "paper-cover");
  const media = article.media || {};
  const imageUrl = media.thumbnail_url || (media.type === "image" ? media.url : "");
  const allowed = mediaAddress(imageUrl);
  if (!allowed) {
    calendarGraphic(article, figure);
    return figure;
  }
  const image = node("img");
  image.alt = media.caption || article.title;
  image.referrerPolicy = "no-referrer"; image.decoding = "async";
  image.addEventListener("error", () => { figure.replaceChildren(); calendarGraphic(article, figure); }, {once: true});
  const source = external(media.source_url || media.url || article.url, media.type === "video" ? "观看原视频" : "查看配图来源");
  const caption = node("figcaption", "", media.caption || (media.type === "video" ? "来源视频封面" : "来源配图"));
  if (source) {
    const preview = source.cloneNode(false);
    preview.className = "cover-link"; preview.setAttribute("aria-label", source.textContent + " · " + article.title);
    preview.append(image); figure.append(preview);
    source.className = "credit"; caption.append(source);
  } else figure.append(image);
  figure.append(caption);
  image.src = allowed;
  return figure;
}

function featuredStory(article) {
  const card = story(article, "feature-story");
  const reason = ui.state.pick_reasons?.[article.id];
  if (reason) card.querySelector("h3").after(node("p", "pick-reason", "推荐理由 · " + reason));
  const revised = article.history?.some(e => e.kind === "revision" && e.date === ui.state.today);
  const label = revised ? "今日修订" : article.first_seen === ui.state.today ? "今日收录" : "近期回顾";
  card.prepend(metadata([[label], [article.brief ? "DeepSeek 选读卡" : "来源摘要"]]));
  card.prepend(paperCover(article));
  return card;
}

function renderToday(parent) {
  const earlierEditions = (ui.state.edition_dates || []).filter(day => day < ui.state.today && /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (earlierEditions.length) {
    const history = node("details", "edition-history");
    history.append(node("summary", "", "往期日报（" + earlierEditions.length + "）"));
    const links = node("div", "inline-list");
    for (const day of earlierEditions) {
      const link = node("a", "section-link", day);
      link.href = "./daily/" + day + ".html";
      links.append(link);
    }
    history.append(links);
    parent.append(history);
  }
  const chosen = (ui.state.picks || []).map(getArticle).filter(Boolean).slice(0, 3);
  const grid = node("section", "daily-grid");
  renderOverview(grid);
  const digest = node("div", "features");
  digest.append(heading("精选阅读", chosen.length + " 篇"));
  const cards = node("div", "feature-list");
  chosen.forEach(article => cards.append(featuredStory(article)));
  if (!chosen.length) {
    cards.append(empty("今天暂无入选成果", "可以在收录记录中查看近期研究。"));
  }
  digest.append(cards); grid.append(digest); parent.append(grid);
  renderPress(parent, false);
  if (Array.isArray(ui.state.community)) renderCommunity(parent);
  renderChannels(parent);
  const follow = node("section", "following");
  const changes = readOnlyWorkspace() ? [] : recentTrackingChanges();
  if (changes.length) follow.append(heading("跟踪动态", changes.length + " 项"));
  changes.slice(0, 5).forEach(({ article, event }) => {
    const row = node("div", "track-row");
    row.append(metadata([[dateLabel(event.date)], [event.reason, "topic"]]), storyTitle(article));
    follow.append(row);
  });
  if (changes.length) parent.append(follow);
  const records = node("section", "recent");
  const header = heading("最近收录");
  const viewAll = node("a", "section-link", "按日期查看全部");
  viewAll.href = "#archive"; header.append(viewAll); records.append(header);
  for (const a of ui.state.articles.slice(0, 5)) records.append(story(a, "paper-row"));
  if (!ui.state.articles.length) records.append(empty("暂无收录记录"));
  parent.append(records);
}

function renderPress(parent, full) {
  const groups = ui.state.press || [];
  const section = node("section", "press-section");
  if (!full) {
    const header = heading("中文媒体报道");
    const all = node("a", "section-link", "查看全部"); all.href = "#press";
    header.append(all); section.append(header);
  }
  const columns = node("div", "source-grid");
  for (const group of groups) {
    const column = node("article", "source-row");
    const rows = group.items || [];
    const head = node("h3", "", group.name);
    head.append(node("small", "event-count", rows.length + " 篇")); column.append(head);
    const list = node("ul", "community-list");
    for (const row of full ? rows : rows.slice(0, 3)) {
      const anchor = external(row.url, row.title);
      if (!anchor) continue;
      anchor.className = "title";
      const li = node("li", "community-row");
      li.append(anchor, node("small", "origin", [row.published, row.topic].filter(Boolean).join(" · ")));
      list.append(li);
    }
    if (rows.length) column.append(list);
    else column.append(node("p", "period", "今天暂无收录。"));
    columns.append(column);
  }
  section.append(columns); parent.append(section);
}

const communityPlatforms = {
  hackernews: { name: "Hacker News", scope: "从首页筛选 AI 讨论，按采样时的帖子积分排列。",
    sortBy: "score", desc: true,
    url: /^https:\/\/news\.ycombinator\.com\/item\?id=[0-9]+$/ },
  zhihu: { name: "知乎 AI 热门话题", scope: "从综合热榜前 30 项筛选 AI 话题，保留原榜名次。",
    sortBy: "rank",
    url: /^https:\/\/(?:www\.zhihu\.com\/question|zhuanlan\.zhihu\.com\/p)\/[0-9]+$/ },
  v2ex: { name: "V2EX", scope: "综合十大热帖中的 AI 话题，以及 OpenAI 节点近期讨论。上榜条目附原榜名次。",
    sortBy: "rank", url: /^https:\/\/www\.v2ex\.com\/t\/[0-9]+$/ },
  huggingface: { name: "Hugging Face Daily Papers", scope: "研究社区推荐的论文，按采样时的赞同数排列。",
    sortBy: "upvotes", desc: true, url: /^https:\/\/huggingface\.co\/papers\/(?:[0-9]{4}\.[0-9]{4,5}|[a-z.-]+\/[0-9]{7})$/i },
};

function communityEmpty(source) {
  if (readOnlyWorkspace()) return "本期暂无可展示的社区采样。";
  if (source?.enabled === false) return "该来源已停用，可在信息来源中启用。";
  if (source?.id === "zhihu" && source.ready === false) return "等待配置知乎密钥。在本机运行 configure-keys.cmd，下一次采集时生效。";
  if (source?.error) return "本次采集未完成，可在信息来源中查看原因。";
  if (source?.last_success === ui.state.today) return source.id === "huggingface"
    ? "本次采集没有可展示的论文推荐。" : "本次采集没有匹配的 AI 话题。";
  return "今天尚无采样记录。";
}

function communityRow(item) {
  const row = node("li", "community-row");
  const link = external(item.url, item.title);
  link.className = "title";
  const metrics = item.metrics || {};
  const labels = [];
  if (item.source_id === "hackernews" && Number.isInteger(metrics.score)) labels.push(metrics.score + " 分");
  if (item.source_id === "huggingface" && Number.isInteger(metrics.upvotes)) labels.push(metrics.upvotes + " 票赞同");
  if (["zhihu", "v2ex"].includes(item.source_id) && Number.isInteger(metrics.rank) && metrics.rank > 0) {
    labels.push("综合榜第 " + metrics.rank + " 名");
  } else if (item.source_id === "v2ex") {
    labels.push("OpenAI 节点");
  }
  if (item.source_id !== "zhihu" && Number.isInteger(metrics.comments)) {
    labels.push(metrics.comments + (item.source_id === "v2ex" ? " 条回复" : " 条评论"));
  }
  if (!labels.length) labels.push("本次未取得指标");
  else if (item.warning) labels.push("指标更新不完整");
  row.append(link, node("div", "subtle", labels.join(" · ")));
  return row;
}

function renderCommunity(parent) {
  const section = node("section");
  section.append(heading("社区热点"));
  const grid = node("div", "source-grid community-grid");
  for (const [key, platform] of Object.entries(communityPlatforms)) {
    const items = ui.state.community.filter(r => r.source_id === key && r.day === ui.state.today && platform.url.test(r.url));
    const priority = r => {
      const v = r.metrics?.[platform.sortBy];
      return Number.isInteger(v) && (platform.desc || v > 0) ? (platform.desc ? -v : v) : Infinity;
    };
    items.sort((a, b) => (priority(a) - priority(b)) || (b.metrics?.comments ?? -1) - (a.metrics?.comments ?? -1));
    const panel = node("div", "source-row");
    panel.append(node("h3", "", platform.name), node("p", "subtle", platform.scope));
    if (items.length) {
      const list = node("ul", "community-list");
      for (const item of items.slice(0, 5)) list.append(communityRow(item));
      panel.append(list);
      if (items.length > 5) {
        const details = node("details", "topic-details");
        const more = node("ul", "community-list");
        for (const item of items.slice(5)) more.append(communityRow(item));
        details.append(node("summary", "", "其余 " + (items.length - 5) + " 项"), more);
        panel.append(details);
      }
    } else {
      panel.append(node("p", "", communityEmpty(findSource(key))));
    }
    grid.append(panel);
  }
  section.append(grid);
  parent.append(section);
}

const channelScopes = {
  "x-research": "关注账号 · 近 24 小时研究动态",
  jiqizhixin: "出版方授权的机器之心订阅",
};

function channelURL(id, raw) {
  if (typeof raw !== "string" || /[\\\s\x00-\x1f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname, path = url.pathname;
    if (id === "x-research" && host === "x.com" && /^\/i\/web\/status\/[1-9][0-9]{0,18}$/.test(path)) return url;
    if (id === "jiqizhixin" && ["jiqizhixin.com", "www.jiqizhixin.com"].includes(host) && /^\/articles\/[\w.%-]+\/?$/.test(path)) return url;
    if (id === "jiqizhixin" && host === "mp.weixin.qq.com") {
      if (/^\/s\/[A-Za-z0-9_-]+\/?$/.test(path)) return url;
      if (path === "/s" && ["__biz","mid","idx","sn"].every(key => url.searchParams.has(key))) return url;
    }
  } catch { /* Invalid platform URL. */ }
  return null;
}

function missingFields(source) {
  if (source.ready !== false) return [];
  const all = source.missing_env || source.required_envs || source.required_env || [];
  return (Array.isArray(all) ? all : [all]).filter(name => typeof name === "string" && /^[A-Z][A-Z0-9_]+$/.test(name));
}

function xWatchlist(groups) {
  const details = node("details", "watchlist");
  const list = node("dl");
  let total = 0;
  for (const group of groups) {
    const accounts = (group.accounts || []).filter(name => /^[A-Za-z0-9_]{1,15}$/.test(name));
    if (!accounts.length) continue;
    total += accounts.length;
    const limit = Number.isInteger(group.limit) ? " · 每次最多 " + group.limit + " 条" : "";
    list.append(node("dt", "", group.name + limit));
    const names = node("dd");
    for (const name of accounts) {
      const link = external("https://x.com/" + name, "@" + name);
      link.className = "account-link"; link.replaceChildren("@" + name); names.append(link);
    }
    list.append(names);
  }
  if (!total) return null;
  details.append(node("summary", "", "正在追踪的 " + total + " 个账号"), list);
  return details;
}

function renderChannels(parent) {
  const sources = ui.state.sources.filter(s => s.private_channel && s.enabled && Object.hasOwn(channelScopes, s.id));
  if (!sources.length) return;
  const section = node("section", "subscription-channels");
  const header = heading(readOnlyWorkspace() ? "订阅动态" : "我的订阅渠道");
  const manage = node("a", "section-link", readOnlyWorkspace() ? "查看来源" : "管理订阅");
  manage.href = "#sources"; header.append(manage); section.append(header);
  const grid = node("div", "source-grid channel-grid");
  for (const source of sources) {
    const card = node("article", "source-row");
    card.append(node("h3", "", source.name), node("p", "subtle", channelScopes[source.id]));
    if (source.id === "x-research" && Array.isArray(source.x_groups)) {
      const accounts = xWatchlist(source.x_groups);
      if (accounts) card.append(accounts);
    }
    grid.append(card);
    const missing = missingFields(source);
    if (source.ready === false) {
      card.append(node("p", "period", readOnlyWorkspace() ? "这个订阅尚无可读快照。" :
        "待配置" + (missing.length ? " · " + missing.join("、") : "") + "。在本机运行 configure-channels.cmd。"));
      continue;
    }
    const sample = ui.state.channel_samples?.[source.id];
    const hasSample = sample && Array.isArray(sample.items);
    if (source.error) {
      card.append(node("p", "source-error", hasSample ? "最近一次采集未完成，以下为上次成功读取的结果。" : "最近一次采集未完成，当前没有有效样本。可在信息来源查看原因。"));
    }
    if (!hasSample) {
      if (!source.error) card.append(node("p", "period", source.last_success ? "上次样本已过期，等待下一次采集。" : "已启用，等待首次采集。"));
      continue;
    }
    const stamp = String(sample.sampled_at || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (stamp) card.append(node("p", "channel-stamp", "北京时间 " + stamp[1] + " " + stamp[2]));
    const urls = new Set(), rows = [];
    for (const item of sample.items) {
      const url = channelURL(source.id, item?.url);
      if (!url || typeof item.title !== "string" || !item.title.trim() || urls.has(url.href)) continue;
      urls.add(url.href);
      const row = node("li", "community-row");
      const link = external(url.href, item.title); link.className = "title"; row.append(link);
      if (item.summary && item.summary !== item.title) row.append(node("p", "subtle", item.summary));
      const metrics = item.metrics || {}, labels = [];
      const fields = source.id === "x-research" ? [["likes","赞"],["comments","条回复"]] : [];
      for (const [key, label] of fields) {
        if (Number.isSafeInteger(metrics[key]) && metrics[key] >= 0) labels.push(metrics[key] + " " + label);
      }
      const credit = [item.author, item.topic, item.published, ...labels].filter(Boolean);
      if (credit.length) row.append(node("div", "subtle", credit.join(" · ")));
      rows.push(row);
    }
    if (!rows.length) {
      card.append(node("p", "period", sample.items.length ? "本次样本没有可打开的原文。" : "本次读取成功，暂无符合条件的条目。"));
      continue;
    }
    const visible = node("ul", "community-list");
    visible.append(...rows.slice(0, 5)); card.append(visible);
    if (rows.length > 5) {
      const more = node("details", "topic-details"), rest = node("ul", "community-list");
      rest.append(...rows.slice(5)); more.append(node("summary", "", "其余 " + (rows.length - 5) + " 条"), rest);
      card.append(more);
    }
  }
  section.append(grid); parent.append(section);
}

function recentTrackingChanges() {
  const since = ui.state.weekly?.start || ui.state.today;
  return ui.state.articles.filter((a) => a.tracking).map((article) => {
    const events = (article.history || []).filter((e) => e.date >= since && e.date <= ui.state.today);
    events.sort((a, b) => b.date.localeCompare(a.date));
    return { article, event: events[0] };
  }).filter((item) => item.event).sort((a, b) => b.event.date.localeCompare(a.event.date));
}

function select(label, values, chosen, onChange) {
  const s = node("select");
  s.setAttribute("aria-label", label);
  const all = node("option", "", label);
  all.value = "";
  s.append(all);
  for (const value of values) {
    const option = node("option", "", value);
    option.value = value;
    s.append(option);
  }
  s.value = chosen;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function renderCatalogue(parent, key, articles) {
  const f = ui.filters[key] ||= { q: "", topic: "", org: "", kind: "", n: 15, basis: "first_seen", range: "" };
  const chronological = key === "archive";
  const filters = node("div", "filters");
  const search = node("label", "search");
  const input = node("input");
  input.type = "search";
  input.placeholder = "搜索标题、摘要或笔记";
  input.setAttribute("aria-label", input.placeholder);
  input.value = f.q;
  search.append(icon("search"), input);
  filters.append(search);
  const list = node("div", "paper-list");
  const more = button("显示更多", () => { f.n += 15; update(); }, "more secondary");
  function update() {
    const needle = f.q.trim().toLocaleLowerCase();
    const latest = dateFromISO(ui.state.today);
    const start = latest && f.range ? new Date(latest.getTime() - (Number(f.range) - 1) * 86400000).toISOString().slice(0, 10) : "";
    const matches = articles.filter((a) =>
      (!f.topic || a.topic === f.topic) && (!f.org || a.org === f.org) && (!f.kind || a.kind === f.kind) &&
      (!chronological || !start || (a[f.basis] >= start && a[f.basis] <= ui.state.today)) &&
      (!needle || [a.title, a.summary, a.brief, a.note, a.org, a.topic, a.url].some(v => String(v || "").toLocaleLowerCase().includes(needle)))
    );
    if (chronological) matches.sort((a, b) => (b[f.basis] || "").localeCompare(a[f.basis] || "") || (b.published || "").localeCompare(a.published || "") || a.title.localeCompare(b.title));
    list.replaceChildren();
    let lastDay;
    for (const article of matches.slice(0, f.n)) {
      const day = article[f.basis] || "";
      if (chronological && day !== lastDay) {
        const group = node("h2", "date-divider", day || "日期待核");
        if (day === ui.state.today) group.append(node("span", "", "今天"));
        list.append(group); lastDay = day;
      }
      const row = story(article, "paper-row");
      if ((key === "notes" || (key === "library" && ui.shelf === "note")) && article.note) {
        row.querySelector(".summary")?.remove();
        row.append(node("p", "summary note-preview", article.note));
      }
      list.append(row);
    }
    if (!matches.length) {
      const hint = readOnlyWorkspace() ? "电脑工作台同步后，可在这里阅读。" : key === "library"
        ? "打开成果详情即可收藏、跟踪或标记已读。" : "刷新来源或手动收录链接后，条目会出现在这里。";
      list.append(empty(articles.length ? "没有匹配的条目" : "这里还没有条目",
        articles.length ? "可以更换关键词或筛选条件。" : hint));
    }
    more.hidden = matches.length <= f.n;
  }
  input.addEventListener("input", () => { f.q = input.value; f.n = 15; update(); });
  if (chronological) {
    const timeBar = node("div", "time-controls");
    const basis = node("div", "tabs"); basis.setAttribute("aria-label", "时间分组");
    for (const [value, title] of [["first_seen", "按收录日"], ["published", "按发表日"]]) {
      const b = button(title, () => {
        f.basis = value; f.n = 15;
        for (const sibling of basis.children) sibling.setAttribute("aria-pressed", String(sibling === b));
        update();
      }, "tab");
      b.setAttribute("aria-pressed", String(f.basis === value)); basis.append(b);
    }
    const range = node("select"); range.setAttribute("aria-label", "时间范围");
    for (const [value, title] of [["", "全部显示日期"], ["1", "今天"], ["7", "最近 7 天"], ["28", "最近 28 天"]]) {
      const choice = node("option", "", title); choice.value = value; range.append(choice);
    }
    range.value = f.range;
    range.addEventListener("change", () => { f.range = range.value; f.n = 15; update(); });
    timeBar.append(basis, range);
    parent.append(timeBar, node("p", "period", readOnlyWorkspace() ? "按收录或发表日期查阅已同步的资料。"
      : "近期入库或更新的资料和书架按日期分组；更早的条目可用相关搜索找回。"));
  }
  for (const [prop, label] of [["kind", "全部类型"], ["topic", "全部主题"], ["org", "全部机构"]]) {
    const unique = [...new Set(articles.map(a => a[prop]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (!unique.includes(f[prop])) f[prop] = "";
    if (unique.length) filters.append(select(label, unique, f[prop], value => { f[prop] = value; f.n = 15; update(); }));
  }
  parent.append(filters, list, more);
  update();
}

function matchingRow(item) {
  const row = node("article", "match-row");
  const local = getArticle(item.id);
  const title = local ? storyTitle(local) : external(item.url, item.title);
  if (!title) return row;
  title.className = "title";
  row.append(metadata([[item.topic, "topic"], [item.kind], [item.period], [item.published && "发表 " + dateLabel(item.published)], [item.first_seen && "收录 " + dateLabel(item.first_seen)]]), title);
  if (item.reason) row.append(node("p", "match-reason", item.reason));
  return row;
}

function renderSearch(parent) {
  const section = node("section", "search-workspace");
  const form = node("form", "query-form");
  const label = node("label", "search query-input");
  const q = node("input"); q.type = "search"; q.maxLength = 240;
  q.placeholder = readOnlyWorkspace() ? "搜索资料、笔记和订阅内容" : "输入论文标题、模型、方法或研究话题";
  q.setAttribute("aria-label", "全库相关搜索"); q.value = ui.archiveQuery;
  label.append(icon("search"), q);
  const submit = node("button", "button primary", "搜索全库"); submit.type = "submit";
  form.append(label, submit);
  const results = node("div", "matches"); results.setAttribute("aria-live", "polite");
  section.append(form, results); parent.append(section);
  let serial = 0;
  async function search() {
    const query = q.value.trim();
    ui.archiveQuery = query;
    const request = ++serial;
    if (!query) {
      results.replaceChildren(empty("搜索历史资料", "输入关键词，或从任意条目详情查看历史相关研究。"));
      return;
    }
    results.replaceChildren(node("p", "period", "正在检索资料库…"));
    try {
      const answer = await api("search?" + new URLSearchParams({q: query}));
      if (serial !== request || !results.isConnected) return;
      const items = answer.items || [];
      results.replaceChildren(heading("相关结果", items.length + " 条"));
      if (!items.length) results.append(empty("没有找到相关资料", "可试试论文简称、模型英文名或研究方法。"));
      items.forEach(item => results.append(matchingRow(item)));
    } catch (err) {
      if (serial === request && results.isConnected) results.replaceChildren(empty("检索暂不可用", err.message));
    }
  }
  q.addEventListener("input", () => { serial++; ui.archiveQuery = q.value; results.replaceChildren(); });
  form.addEventListener("submit", e => { e.preventDefault(); search(); });
  search();
}

function relatedReading(article, parent) {
  const section = node("section", "reader-related");
  section.append(heading("相关历史阅读"));
  const list = node("div", "matches");
  list.append(node("p", "period", "正在从资料库匹配…"));
  section.append(list); parent.append(section);
  const apply = answer => {
    if (!list.isConnected) return;
    list.replaceChildren();
    const items = (answer.items || []).filter(r => r.id !== article.id);
    if (items.length) items.forEach(r => list.append(matchingRow(r)));
    else list.append(node("p", "period", "资料库中暂时没有足够相关的历史条目。"));
  };
  let work = ui.related.get(article.id);
  if (!work) {
    work = api("search?" + new URLSearchParams({id: article.id}));
    ui.related.set(article.id, work);
  }
  work.then(apply).catch(err => {
    if (ui.related.get(article.id) === work) ui.related.delete(article.id);
    if (list.isConnected) list.replaceChildren(node("p", "source-error", err.message));
  });
}

function renderBalances(parent) {
  const section = node("section", "account-balances");
  const header = node("div", "section-heading");
  const grid = node("div", "balance-grid");
  const refresh = button("刷新余额", load, "secondary", "sync");
  refresh.title = "服务商查询结果在本机缓存 60 秒";
  header.append(node("h2", "", "余额与额度"), refresh);
  section.append(header, grid);
  parent.append(section);

  async function load() {
    grid.replaceChildren();
    refresh.disabled = true;
    const providers = [["deepseek", "DeepSeek 可用余额"], ["x", "X 可用余额"], ["zhihu", "知乎热榜今日剩余限免额度"]];
    await Promise.all(providers.map(async ([provider, title]) => {
      const card = node("article", "source-row balance-card");
      const values = node("div", "balance-values");
      values.setAttribute("aria-live", "polite");
      values.append(node("p", "subtle", "查询中…"));
      card.append(node("h3", "", title), values);
      grid.append(card);
      try {
        const data = await api("balance/" + provider);
        values.replaceChildren();
        if (data.status !== "ok") {
          values.append(node("p", "subtle", data.message));
          if (provider === "x") {
            const consoleLink = external("https://console.x.com/", "X 开发者控制台");
            values.append(consoleLink);
          }
          return;
        }
        if (provider === "zhihu") {
          values.append(node("strong", "balance-number", data.remaining + " 次"),
            node("p", "subtle", "每日限免 " + data.total + " 次"));
        } else {
          for (const row of data.balances) {
            values.append(node("strong", "balance-number", row.currency + " " + row.total_balance),
              node("p", "subtle", "充值 " + row.topped_up_balance + " · 赠送 " + row.granted_balance));
          }
          if (data.is_available === false) values.append(node("p", "source-error", "服务商提示余额不足以调用 API。"));
        }
        const checked = new Date(data.checked_at);
        values.append(node("p", "subtle", "查询于 " + checked.toLocaleTimeString("zh-CN", {hour12:false})));
      } catch {
        values.replaceChildren(node("p", "subtle", "本机暂未读到额度，请稍后刷新。"));
      }
    }));
    refresh.disabled = false;
  }
  load();
}

function renderUsage(parent) {
  const usage = ui.state.usage || {};
  renderBalances(parent);
  const tabs = node("div", "tabs");
  for (const [value, title] of [["today", "今天"], ["period", typeof usage.period === "string" ? usage.period : "近 30 天"]]) {
    const b = button(title, () => { ui.usagePeriod = value; render(); }, "tab");
    b.setAttribute("aria-pressed", String(ui.usagePeriod === value)); tabs.append(b);
  }
  parent.append(tabs);
  const providers = (ui.usagePeriod === "today" ? usage.today : usage.providers) || [];
  if (!providers.length) { parent.append(empty("本期尚无已记录的 API 调用")); return; }
  const sums = node("div", "usage-overview");
  const totals = [["requests", "请求次数"], ["success", "成功"], ["failed", "失败"]];
  for (const [field, title] of totals) {
    const card = node("div", "stat");
    const value = providers.reduce((total, p) => total + (Number(p[field]) || 0), 0);
    card.append(node("span", "", title), node("strong", "", value.toLocaleString("zh-CN"))); sums.append(card);
  }
  parent.append(sums);
  const formatter = new Intl.NumberFormat("zh-CN");
  const grid = node("div", "usage-grid");
  for (const p of providers) {
    const card = node("article", "source-row usage-card");
    card.append(node("h2", "", p.name || p.id));
    const list = node("dl", "ledger");
    const rows = [["请求", p.requests], ["成功", p.success], ["失败", p.failed]];
    if (p.pending > 0) rows.push(["进行中或中断", p.pending]);
    if (p.id === "deepseek" || p.kind === "model" || p.input_tokens != null || p.output_tokens != null || p.unknown_usage > 0) {
      rows.push(["已报告输入 tokens", p.input_tokens], ["已报告输出 tokens", p.output_tokens], ["用量未返回的请求", p.unknown_usage]);
    }
    for (const [name, value] of rows) {
      list.append(node("dt", "", name), node("dd", "", value == null ? "未报告" : formatter.format(value)));
    }
    card.append(list); grid.append(card);
  }
  parent.append(grid, node("p", "period usage-note", "请求数来自本机用量记录，tokens 采用服务商返回的数据。"));
}

function renderLibrary(parent) {
  const all = ui.state.articles;
  if (readOnlyWorkspace()) {
    renderCatalogue(parent, "notes", all.filter(a => a.note?.trim()));
    return;
  }
  const tabs = node("div", "tabs");
  for (const [key, name] of [["saved", "已收藏"], ["tracking", "跟踪中"], ["read", "已读"], ["note", "我的笔记"]]) {
    const total = all.filter(a => a[key]).length;
    const b = button(name + " " + total, () => { ui.shelf = key; render(); }, "tab");
    b.setAttribute("aria-pressed", String(ui.shelf === key));
    tabs.append(b);
  }
  parent.append(tabs);
  renderCatalogue(parent, "library", all.filter((a) => a[ui.shelf]));
}

function renderWeek(parent) {
  const w = ui.state.weekly || {};
  const panel = node("section", "week-panel panel");
  panel.append(heading("各方向收录量"), node("p", "period", (w.start || "—") + " 至 " + (w.end || ui.state.today) +
    (w.complete && w.previous_start ? " · 对照期自 " + w.previous_start + " 起" : " · 比较窗口的采集记录尚不完整")));
  if (!w.topics?.length) {
    panel.append(empty("本周暂无收录", "有新成果时，按主方向统计到这里。"));
  } else {
    const table = node("table");
    const row = node("tr");
    for (const title of ["研究方向", "本周截至今日", "上周同期"]) {
      const th = node("th", "", title); th.scope = "col"; row.append(th);
    }
    const head = node("thead"); head.append(row); table.append(head);
    const body = node("tbody");
    for (const item of w.topics) {
      const tr = node("tr");
      const topicCell = node("td");
      const details = node("details", "topic-details");
      details.append(node("summary", "", item.topic));
      details.addEventListener("toggle", () => {
        if (!details.open || details.children.length > 1) return;
        const records = ui.state.articles.filter(a => a.is_research && a.topic === item.topic && a.first_seen >= w.start && a.first_seen <= w.end);
        const list = node("ul", "topic-records");
        for (const article of records) {
          const entry = node("li");
          entry.append(storyTitle(article));
          list.append(entry);
        }
        details.append(records.length ? list : node("p", "period", "本周尚无新收录。"));
      });
      topicCell.append(details);
      tr.append(topicCell, node("td", "", item.current), node("td", "", w.complete ? item.previous : "—"));
      body.append(tr);
    }
    table.append(body); panel.append(table);
  }
  parent.append(panel);
  const timeline = node("section");
  timeline.append(heading("本周变化", (w.changes || []).length + " 项"));
  if (!w.changes?.length) timeline.append(empty("本周暂无变化记录", "来源更新和成果修订将按日期显示。"));
  for (const event of w.changes || []) {
    const article = getArticle(event.id);
    const row = node("div", "paper-row");
    row.append(metadata([[dateLabel(event.date)], [event.reason, "topic"]]),
      article ? storyTitle(article) : node("span", "", event.title));
    timeline.append(row);
  }
  parent.append(timeline);
}

function renderLibrarySettings(parent) {
  const institution = node("section", "institution panel");
  institution.append(heading("学校图书馆入口"), node("p", "subtle", "保存本校图书馆或校外访问的 HTTPS 入口。查阅论文时，可前往学校网站完成身份认证。"));
  const form = node("form", "library-form");
  const input = node("input"); input.type = "url"; input.placeholder = "https://";
  input.value = ui.state.library_url || ""; input.setAttribute("aria-label", "学校图书馆 HTTPS 网址");
  const save = node("button", "button secondary", "保存入口"); save.type = "submit";
  const response = node("p", "form-status"); response.setAttribute("role", "status");
  form.append(input, save);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const url = input.value.trim(); const target = url && external(url, "");
    if (url && (!target || !target.href.startsWith("https://"))) { response.textContent = "请输入有效的 HTTPS 地址。"; return; }
    save.disabled = true;
    try {
      await api("library", {url});
      await reload(); notice(url ? "学校图书馆入口已保存。" : "学校图书馆入口已清除。");
    } catch (err) { response.textContent = err.message; }
    finally { save.disabled = false; }
  });
  institution.append(form, response); parent.append(institution);
}

function renderSources(parent) {
  const readOnly = readOnlyWorkspace();
  if (!readOnly) renderLibrarySettings(parent);
  const groups = [
    [true, "自动采集"], [false, "手动来源"],
  ];
  for (const [automatic, title] of groups) {
    const sources = ui.state.sources.filter(s => (s.mode === "auto") === automatic);
    if (!sources.length) continue;
    const section = node("section");
    section.append(heading(title, sources.length + " 个来源"));
    const grid = node("div", "source-grid");
    for (const s of sources) {
      const item = node("article", "source-row");
      item.append(metadata([[s.kind, "topic"], [s.method]]), node("h3", "", s.name));
      if (s.description) item.append(node("p", "subtle", s.description));
      if (automatic) item.append(node("p", "subtle", s.last_success ? "上次成功采集 " + dateLabel(s.last_success) : "尚无成功采集记录"));
      if (s.error) item.append(node("p", "source-error", readOnly ? "最近一次采集未完成。" : "采集提示 · " + s.error));
      const missing = missingFields(s);
      if (!readOnly && s.ready === false && (s.required_env || s.required_envs?.length || s.private_channel)) {
        const help = s.private_channel || s.id === "qwen-x"
          ? "运行本机 configure-channels.cmd 完成渠道配置。" + (missing.length ? " 待填写 " + missing.join("、") : "")
          : s.id === "zhihu" ? "运行本机 configure-keys.cmd 保存知乎密钥，下一次采集时生效。"
          : "需在本机设置 " + missing.join("、") + "。";
        item.append(node("p", "subtle", help));
      }
      const actions = node("div", "action-line");
      const link = external(s.url, "来源主页");
      if (link) actions.append(link);
      if (automatic && !readOnly) {
        const unavailable = s.ready === false && !s.enabled;
        const waiting = s.ready === false && s.enabled;
        const b = button(waiting ? "已订阅 · 待配置" : unavailable ? "待配置" : s.enabled ? "已启用" : "已停用",
          () => toggleSource(s, b));
        b.disabled = unavailable;
        b.setAttribute("aria-label", (s.enabled ? "停用 " : "启用 ") + s.name);
        b.setAttribute("aria-pressed", String(Boolean(s.enabled)));
        actions.append(b);
      }
      item.append(actions); grid.append(item);
    }
    section.append(grid); parent.append(section);
  }
  if (!ui.state.sources.length) parent.append(empty("尚未配置来源"));
}

async function toggleSource(source, b) {
  b.disabled = true;
  try {
    await api("sources", { id: source.id, enabled: !source.enabled });
    await reload();
    notice(source.name + (source.enabled ? " 已停用。" : " 已启用。"));
  } catch (error) { notice(error.message, true); }
  finally { b.disabled = false; }
}

function openReader(id) {
  if (!getArticle(id)) return;
  ui.readerId = id;
  renderReader();
  const dialog = byId("reader");
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function renderBackground(article, body) {
  const guide = article.background || {};
  const busy = ui.pending.has(article.id + ":background");
  const statuses = {ready: "已整理", partial: "部分资料可用", empty: "暂未找到", pending: "待补充"};
  const section = node("section", "reader-background");
  section.append(heading("背景补读", busy ? "正在查找…" : statuses[guide.status] || ""));
  const list = node("ul", "reading-guides");
  const seen = new Set();
  for (const resource of Array.isArray(guide.resources) ? guide.resources : []) {
    if (!resource?.title || !resource.source || !resource.url?.startsWith("https://")) continue;
    const link = external(resource.url, resource.title);
    if (!link || seen.has(link.href)) continue;
    seen.add(link.href);
    link.className = "guide-link";
    const item = node("li");
    item.append(metadata([[resource.kind || "背景资料", "topic"], [resource.source]]), link);
    if (resource.reason) item.append(node("p", "guide-reason", resource.reason));
    list.append(item);
    if (list.children.length === 6) break;
  }
  if (list.children.length) {
    if (guide.intro) section.append(node("p", "guide-intro", guide.intro));
    section.append(list);
  } else {
    if (readOnlyWorkspace()) return;
    const text = guide.status === "empty" ? "本次没有找到可核对的背景资料。"
      : guide.status === "partial" ? "部分来源暂时不可用，可重新查找。"
      : "可查找这条资料涉及的基础概念、前序工作或讲解视频。";
    section.append(node("p", "period", text));
  }
  if (!readOnlyWorkspace() && Array.isArray(guide.warnings)) {
    for (const warning of guide.warnings.filter(v => typeof v === "string" && v).slice(0, 3)) {
      section.append(node("p", "period", warning));
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(guide.checked || "")) section.append(node("p", "period", "上次查找 " + guide.checked));
  body.append(section);
  if (readOnlyWorkspace()) return;
  if (article.sources?.length && article.sources.every(id => id === "manual")) {
    section.append(node("p", "period", "点击后仅用题名联网查找。"));
  }
  const find = button(busy ? "查找中…" : "查找背景资料", () => lookupBackground(article), "secondary", "search");
  find.disabled = busy;
  section.append(find);
}

async function lookupBackground(article) {
  const key = article.id + ":background";
  if (ui.pending.has(key)) return;
  ui.pending.add(key);
  renderReader();
  let failure;
  try {
    const result = await api("background", {id: article.id});
    if (!result.background || typeof result.background !== "object") throw new Error("服务未返回背景资料。");
    const cached = getArticle(article.id);
    if (cached) cached.background = result.background;
  } catch (error) { failure = error; }
  finally {
    ui.pending.delete(key);
    if (byId("reader").open && ui.readerId === article.id) renderReader();
  }
  if (failure) articleStatus(article.id, "背景查找未完成，可重试。 " + failure.message, true);
}

function renderReader() {
  const a = getArticle(ui.readerId);
  if (!a) return;
  const body = byId("reader-body");
  const oldNote = byId("reader-note");
  const editingNote = oldNote && document.activeElement === oldNote;
  const oldCursor = editingNote ? oldNote.selectionStart : 0;
  const hadNoteDraft = ui.drafts.has(a.id);
  const readOnly = readOnlyWorkspace();
  body.replaceChildren();
  const title = node("h2", "", a.title || a.url || "研究详情");
  title.id = "reader-title";
  body.append(title, metadata([
    [a.topic, "topic"], [a.kind], [a.org], [a.version && "v" + a.version],
    [a.published && "发布 " + dateLabel(a.published)], [a.first_seen && "首次收录 " + dateLabel(a.first_seen)],
    [a.updated && a.updated !== a.first_seen && "收录更新 " + dateLabel(a.updated)],
  ]));
  const links = node("div", "inline-list");
  const mainLink = external(a.url, "打开原文");
  if (mainLink) links.append(mainLink);
  if (!readOnly && ui.state.library_url) {
    const library = external(ui.state.library_url, "学校图书馆");
    if (library) links.append(library);
  }
  const linkedUrls = new Set([a.url]);
  for (const item of a.links || []) {
    if (linkedUrls.has(item.url)) continue;
    const name = findSource(item.source_id)?.name || "相关来源";
    const link = external(item.url, name);
    if (link) { links.append(link); linkedUrls.add(item.url); }
  }
  body.append(links);
  const provenance = (a.sources || []).map(id => findSource(id)?.name || id).join("、");
  if (provenance) body.append(node("p", "period", "收录来源 · " + provenance));
  if (readOnly && a.note?.trim()) {
    const note = node("section", "reading-note");
    note.append(node("h3", "", "研究笔记"), node("p", "read-text", a.note));
    body.append(note);
  }
  const metricLabels = { upvotes: "赞同", comments: "评论", likes: "喜欢", score: "积分", rank: "综合榜名次" };
  for (const m of a.metrics || []) {
    if (!Object.hasOwn(metricLabels, m.metric)) continue;
    const source = findSource(m.source_id)?.name || m.source_id;
    const line = node("p", "period");
    const platform = communityPlatforms[m.source_id];
    if (platform && platform.url.test(m.url)) {
      const link = external(m.url, m.title || "查看话题");
      link.className = "metric-link";
      line.append(link, document.createTextNode(" · "));
    }
    let change = "";
    if (m.previous_day && Number.isInteger(m.delta)) {
      let movement = (m.delta > 0 ? "+" : "") + m.delta;
      if (m.metric === "rank") movement = m.delta === 0 ? "持平" : (m.delta < 0 ? "上升 " : "下降 ") + Math.abs(m.delta) + " 名";
      change = "，较 " + m.previous_day + " " + movement;
    }
    line.append(document.createTextNode(source + " · " + metricLabels[m.metric] + " " + m.value + "（" + m.day + change + "）"));
    body.append(line);
  }
  if (a.brief) body.append(node("h3", "", "中文摘要"), node("p", "read-text", a.brief));
  body.append(node("h3", "", "原文摘要"), node("p", "read-text", a.summary || "该来源尚未提供摘要。"));
  renderBackground(a, body);
  if (!readOnly) renderReadingControls(a, body);
  if (a.history?.length) {
    const history = node("details", "history");
    history.append(node("summary", "", "查看进展时间线（" + a.history.length + "）"));
    const list = node("ul", "timeline");
    for (const e of a.history) list.append(node("li", "", dateLabel(e.date) + " · " + e.reason));
    history.append(list); body.append(history);
  }
  relatedReading(a, body);
  if (readOnly) return;
  const noteLabel = node("label", "field", "我的笔记");
  const note = node("textarea");
  note.id = "reader-note"; note.rows = 4;
  note.value = hadNoteDraft ? ui.drafts.get(a.id) : a.note || "";
  const save = button("保存笔记", () => editArticle(a, "note", note.value), "primary");
  save.disabled = note.value === (a.note || "") || ui.pending.has(a.id + ":note");
  note.addEventListener("input", () => {
    ui.drafts.set(a.id, note.value);
    save.disabled = note.value === (a.note || "") || ui.pending.has(a.id + ":note");
  });
  noteLabel.append(note); body.append(noteLabel, save);
  const status = node("p", "form-status");
  status.id = "reader-status";
  status.setAttribute("role", "status");
  body.append(status);
  if (editingNote) {
    note.focus({ preventScroll: true });
    note.setSelectionRange(oldCursor, oldCursor);
  }
}

function renderReadingControls(a, body) {
  const controls = node("div", "action-line");
  for (const [field, on, off, symbol] of [
    ["saved", "已收藏", "收藏", "bookmark"],
    ["tracking", "跟踪中", "持续跟踪", "track"],
    ["read", "已读", "标记已读", "check"],
  ]) {
    const b = button(a[field] ? on : off, () => editArticle(a, field, !a[field]), "secondary", symbol);
    b.setAttribute("aria-pressed", String(Boolean(a[field])));
    b.disabled = ui.pending.has(a.id + ":" + field);
    controls.append(b);
  }
  if (ui.state.ai_enabled && !a.brief && a.summary?.trim()) {
    const generating = ui.pending.has(a.id + ":brief");
    const b = button(generating ? "正在生成…" : "生成中文摘要", () => generateBrief(a));
    b.disabled = generating;
    controls.append(b);
  }
  body.append(controls);
}

function articleStatus(id, message, isError = false) {
  const status = byId("reader-status");
  if (byId("reader").open && ui.readerId === id && status) {
    status.textContent = message;
    status.classList.toggle("source-error", isError);
  } else {
    notice(message, isError);
  }
}

async function editArticle(article, field, value) {
  const key = article.id + ":" + field;
  if (ui.pending.has(key)) return;
  ui.pending.add(key);
  renderReader();
  let errorMessage = "";
  let written = false;
  try {
    await api("article", {id: article.id, [field]: value});
    written = true;
    const cached = getArticle(article.id);
    if (cached) cached[field] = value;
    if (field === "note" && ui.drafts.get(article.id) === value) ui.drafts.delete(article.id);
    await reload();
  } catch (error) {
    errorMessage = (written ? "已保存，列表暂未刷新。 " : "保存失败。 ") + error.message;
  } finally {
    ui.pending.delete(key);
    if (byId("reader").open && ui.readerId === article.id) renderReader();
  }
  articleStatus(article.id, errorMessage || (field === "note" ? "笔记已保存。" : "阅读状态已更新。"), Boolean(errorMessage));
}

async function generateBrief(article) {
  const key = article.id + ":brief";
  if (ui.pending.has(key)) return;
  ui.pending.add(key);
  renderReader();
  let failure;
  try {
    await api("brief", { id: article.id });
    await reload();
  } catch (error) { failure = error; }
  finally {
    ui.pending.delete(key);
    if (byId("reader").open && ui.readerId === article.id) renderReader();
  }
  articleStatus(article.id, failure?.message || "中文摘要已更新。", Boolean(failure));
}

async function refreshSources() {
  if (ui.refreshPending) return;
  const b = byId("refresh");
  ui.refreshPending = true;
  b.disabled = true;
  b.querySelector("span").textContent = "正在采集…";
  notice("正在检查已启用的来源，可继续阅读已有条目。");
  let result;
  try {
    result = await api("refresh", {});
    await reload();
    const outcomes = result.results || [];
    if (!outcomes.length) {
      notice("没有可刷新的来源。可在「信息来源」启用自动采集。");
    } else {
      const completed = outcomes.filter(row => !row.error && !row.skipped && !row.warning);
      const messages = ["完整采集 " + completed.length + " 个来源。"];
      let failed = false;
      for (const row of outcomes) {
        const name = findSource(row.id)?.name || row.id;
        if (row.error) {
          failed = true;
          messages.push(name + " 采集失败，请到「信息来源」查看原因。");
        } else if (row.skipped) {
          messages.push(name + " " + row.skipped + "。");
        } else if (row.warning) {
          messages.push(name + " 已收录，" + row.warning + "。");
        }
      }
      if (result.reading) {
        messages.push(result.reading.message);
        if (result.reading.error) { failed = true; messages.push(result.reading.error); }
      }
      notice(messages.join(" "), failed);
    }
  } catch (error) { notice(error.message, true); }
  finally {
    ui.refreshPending = false; b.disabled = false; b.querySelector("span").textContent = "刷新来源";
  }
}

async function importLink(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  const status = byId("import-status");
  if (!external(fields.url, "")) { status.textContent = "请填写完整的 http 或 https 网址。"; return; }
  const b = form.querySelector("button[type=submit]");
  if (b.disabled) return;
  b.disabled = true; status.textContent = "正在收录…";
  let written = false;
  try {
    const result = await api("import", fields);
    written = true;
    await reload();
    form.reset();
    byId("importer").close();
    notice("链接已收录。");
    if (result.id && getArticle(result.id)) openReader(result.id);
  } catch (error) {
    status.textContent = (written ? "链接已收录，列表暂未刷新。 " : "") + error.message;
  } finally { b.disabled = false; }
}

async function start() {
  try { await reload(); }
  catch (error) {
    const content = byId("content");
    content.setAttribute("aria-busy", "false");
    content.replaceChildren(empty("暂时无法读取资料", error.message), button("重新连接", start, "more secondary"));
  }
}

document.querySelector(".skip").addEventListener("click", (e) => { e.preventDefault(); byId("main").focus(); });
const navToggle = byId("nav-toggle");
navToggle.addEventListener("click", () => {
  navToggle.setAttribute("aria-expanded", String(navToggle.getAttribute("aria-expanded") !== "true"));
});
byId("main-nav").addEventListener("click", (e) => {
  if (e.target.closest("a")) navToggle.setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navToggle.getAttribute("aria-expanded") === "true") {
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.focus();
  }
});
byId("open-import").addEventListener("click", () => {
  if (!ui.state || readOnlyWorkspace()) return;
  byId("import-status").textContent = "";
  if (!byId("importer").open) byId("importer").showModal();
});
byId("import-form").addEventListener("submit", importLink);
byId("refresh").addEventListener("click", refreshSources);
window.addEventListener("hashchange", navigate);
start();


