function queryTerms(value) {
  const parts=value.toLowerCase().match(/[a-z0-9][a-z0-9_.-]*|[\p{Script=Han}]+/gu)||[];
  const words=new Set();
  for (const part of parts) {
    if (part.length<2 || /^(of|an|in|at|to|for|the|with|and|from|on|by|is|are)$/.test(part)) continue;
    words.add(part);
    if (/\p{Script=Han}/u.test(part) && part.length>2)
      for (let i=0;i<part.length-1;i++) words.add(part.slice(i,i+2));
  }
  return [...words].slice(0,40);
}

function matchingLenses(phrase, lenses) {
  const matches = [];
  for (const [label, aliases] of Object.entries(lenses || {})) {
    if (!Array.isArray(aliases) || !aliases.length) continue;
    const patterns = aliases.map(alias => {
      const literal = alias.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
      return /[^\x00-\x7f]/.test(alias) ? literal : "(?:^|[^a-z0-9])" + literal + "s?(?![a-z0-9])";
    });
    const pattern = new RegExp(patterns.join("|"), "iu");
    if (pattern.test(phrase)) matches.push([label, pattern]);
  }
  return matches;
}

export function searchReading(state, archived, query, id) {
  const q=query.trim().normalize("NFKC").toLowerCase();
  const articles=new Map([...archived,...state.articles].map(a=>[a.id,a]));
  const target=articles.get(id);
  if (id && !target) return null;
  const primary=(q || target?.title?.toLowerCase() || "").normalize("NFKC");
  if (!primary) return [];
  for (const [source,sample] of Object.entries(state.channel_samples || {})) {
    for (const entry of sample.items || []) {
      if (!entry.url || !entry.title) continue;
      const key=source+":"+entry.url;
      articles.set(key,{...entry,id:key,kind:state.sources.find(s=>s.id===source)?.name || "订阅动态",
        first_seen:(sample.sampled_at || "").slice(0,10)});
    }
  }
  const terms=queryTerms(primary), matches=[];
  const lenses=matchingLenses(primary,state.search_lenses);
  for (const a of articles.values()) {
    if (a.id===id) continue;
    const title=(a.title || "").normalize("NFKC").toLowerCase();
    const note=(a.note || "").normalize("NFKC").toLowerCase();
    const text=[a.topic,a.org,a.author,a.summary,a.brief,note].join(" ").normalize("NFKC").toLowerCase();
    const hits=terms.filter(t=>title.includes(t)||text.includes(t));
    const sameTopic=target && target.topic && target.topic!=="待细分" && a.topic===target.topic;
    const shared=lenses.filter(([, pattern])=>pattern.test(title + " " + text)).map(([label])=>label);
    const full=title.includes(primary);
    const noteMatch=Boolean(q && note.includes(q));
    if (!hits.length && !full && !sameTopic && !noteMatch && !shared.length) continue;
    const score=hits.reduce((s,t)=>s+(title.includes(t)?4:1),0)+(full?12:0)+(noteMatch?8:0)+(sameTopic?2:0)+4*shared.length;
    const {title:label,url:link,kind,topic,published,first_seen}=a;
    let reason = "主题相近：" + topic;
    if (noteMatch) reason = "笔记包含搜索词";
    else if (shared.length) reason = "主题相近：" + shared.slice(0,2).join("、");
    else if (hits.length) reason = "关键词重合（" + hits.slice(0,3).join("、") + "）";
    matches.push({score, item:{id:a.id,title:label,url:link,kind,topic,published,first_seen,reason,
      period:first_seen<state.today?"历史收录":"当日收录"}});
  }
  matches.sort((a,b)=>b.score-a.score || (b.item.published||"").localeCompare(a.item.published||""));
  return matches.slice(0,8).map(row=>row.item);
}
