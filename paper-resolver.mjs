// Public bibliographic lookup only. Fetches are restricted to fixed metadata APIs.
// A listed author/coauthor is not evidence of a PhD or Postdoc relationship.
import {normalizeORCID} from './paper-importer.mjs?v=arxiv-affiliations-20261124';
import {nameMatchKind} from './name-matching.mjs?v=author-alias-20261111';
const CROSSREF = 'https://api.crossref.org';
const DATACITE = 'https://api.datacite.org';
const OPENALEX = 'https://api.openalex.org';
const CATALOG_URL = new URL('./paper-catalog.json', import.meta.url);
const API_HOSTS = new Set(['api.crossref.org', 'api.datacite.org', 'api.openalex.org']);
const NON_PAPER_TYPES = new Set(['dataset', 'software', 'collection', 'image', 'model', 'workflow', 'physicalobject', 'instrument', 'service', 'grant', 'component']);
const REQUEST_TIMEOUT = 15000;
const RESULT_LIMIT = 12;
let catalogPromise;

function text(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'").replace(/\s+/g, ' ').trim();
}
export function normalizePaperTitle(value) {
  return text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
export function normalizeDoi(value) {
  let raw = String(value ?? '').trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  try { const url = new URL(String(value ?? '').trim()); if (['doi.org', 'dx.doi.org'].includes(url.hostname.toLowerCase())) raw = url.pathname.slice(1); } catch { /* Bare DOI identifiers are expected. */ }
  try { raw = decodeURIComponent(raw); } catch { /* Keep a literal identifier when percent escapes are malformed. */ }
  raw = raw.replace(/[\s\u00a0]+$/g, '').replace(/[.,;]+$/g, '');
  // Identifier delimiters are excluded. DOI path punctuation is otherwise retained.
  return /^10\.\d{4,9}\/[^\s<>"?#]+$/i.test(raw) && raw.length <= 512 ? raw.toLowerCase() : undefined;
}
export function normalizeArxivId(value) {
  let raw = String(value ?? '').trim().replace(/^arxiv:\s*/i, '');
  try {
    const u = new URL(raw);
    if (!['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(u.hostname.toLowerCase())) return undefined;
    raw = u.pathname.replace(/^\/(?:abs|pdf|html)\//i, '').replace(/\.pdf$/i, '');
  } catch { /* A bare arXiv identifier is supported too. */ }
  raw = raw.replace(/v\d+$/i, '');
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/i.test(raw) ? raw.toLowerCase() : undefined;
}
function arxivFromDoi(doi) {
  return doi?.startsWith('10.48550/arxiv.') ? normalizeArxivId(doi.slice('10.48550/arxiv.'.length)) : undefined;
}
function extractOrcid(value) {
  // Share the importer's strict host/path parser; never extract an ID substring
  // from an unrelated URL and accidentally turn it into a trusted bare ORCID.
  return normalizeORCID(value) || undefined;
}
function publicAffiliation(value) {
  return text(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, '')
    .replace(/\b(?:e-?mail|correspondence|tel(?:ephone)?|phone|fax)\s*:?\s*(?:[+()\d][\d\s().-]{5,})?/gi, '')
    .replace(/\s+/g, ' ').replace(/[\s,;.]+$/g, '').trim().slice(0, 1000);
}
function affiliationText(affiliations) {
  const values=Array.isArray(affiliations)?affiliations:[affiliations];
  return [...new Set(values.map(a=>publicAffiliation(typeof a==='string'?a:a?.name)).filter(Boolean))].join('; ').slice(0, 1000);
}
function affiliationSourceList(sources) {
  const raw=Array.isArray(sources)?sources:[],result=sourceList(raw);
  return result.map(source=>{const original=raw.find(item=>item?.url===source.url),year=recordYear(original?.year);return {...source,...(year?{year}:{})};});
}
function authorRecord(name, {orcid, affiliation, externalId, affiliationSources} = {}) {
  const result = {name: text(name)};
  if (!result.name) return null;
  if (orcid) result.orcid = orcid;
  if (affiliation) {result.affiliation = affiliation;const sources=affiliationSourceList(affiliationSources);if(sources.length)result.affiliationSources=sources;}
  if (externalId || orcid) result.externalId = externalId || `orcid:${orcid}`;
  return result;
}
function recordYear(...values) {
  for (const value of values) {
    const year = Number(Array.isArray(value?.['date-parts']) ? value['date-parts'][0]?.[0] : value);
    if (Number.isInteger(year) && year >= 1500 && year <= 2200) return year;
  }
  return undefined;
}
function sourceList(sources) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : []).map(s => ({name: text(s?.name), url: safeURL(s?.url)})).filter(s => {
    if (!s.name || !s.url || seen.has(s.url)) return false;
    seen.add(s.url); return true;
  });
}
function baseRecord({title, authors, doi, arxivId, year, url, sources}) {
  title = text(title); doi = normalizeDoi(doi); arxivId = normalizeArxivId(arxivId) || arxivFromDoi(doi);
  if (!title) return null;
  const result = {id: arxivId ? `arxiv:${arxivId}` : doi ? `doi:${doi}` : `title:${normalizePaperTitle(title)}`, title, authors: (authors || []).filter(Boolean), url: arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : safeURL(url), sources: sourceList(sources)};
  if (!result.url || !result.sources.length) return null;
  if (doi) result.doi = doi;
  if (arxivId) result.arxivId = arxivId;
  if (year) result.year = year;
  return result;
}
export function normalizeCrossrefWork(work, sourceURL) {
  if (!work || NON_PAPER_TYPES.has(String(work.type || '').toLowerCase())) return null;
  const authors = (Array.isArray(work.author) ? work.author : []).map(a => authorRecord([text(a.given), text(a.family)].filter(Boolean).join(' ') || a.name, {orcid: extractOrcid(a.ORCID), affiliation: affiliationText(a.affiliation), affiliationSources:[{name:'Crossref · publisher author affiliation',url:sourceURL || `${CROSSREF}/works/${doiPath(work.DOI)}`,year:recordYear(work.published,work.issued,work['published-print'],work['published-online'])}]}));
  return baseRecord({title: Array.isArray(work.title) ? work.title[0] : work.title, authors, doi: work.DOI, year: recordYear(work.published, work.issued, work['published-print'], work['published-online']), url: work.URL, sources: [{name: 'Crossref · publisher DOI metadata', url: sourceURL || `${CROSSREF}/works/${doiPath(work.DOI)}`}]});
}
export function normalizeDataCiteWork(work, sourceURL) {
  const a = work?.attributes || work;
  if (!a || NON_PAPER_TYPES.has(String(a.types?.resourceTypeGeneral || '').toLowerCase())) return null;
  const authors = (Array.isArray(a.creators) ? a.creators : []).map(c => {
    const name = [text(c.givenName), text(c.familyName)].filter(Boolean).join(' ') || c.name;
    const orcid = extractOrcid((c.nameIdentifiers || []).find(i => String(i.nameIdentifierScheme || '').toLowerCase() === 'orcid')?.nameIdentifier);
    return authorRecord(name, {orcid, affiliation: affiliationText(c.affiliation),affiliationSources:[{name:'DataCite · paper author affiliation',url:sourceURL || `${DATACITE}/dois/${doiPath(a.doi || work.id)}`,year:recordYear(a.publicationYear)}]});
  });
  const arxivId = (a.identifiers || []).find(i => String(i.identifierType || '').toLowerCase() === 'arxiv')?.identifier || normalizeArxivId(a.url);
  return baseRecord({title: a.titles?.[0]?.title, authors, doi: a.doi || work.id, arxivId, year: recordYear(a.publicationYear), url: a.url, sources: [{name: 'DataCite · repository DOI metadata', url: sourceURL || `${DATACITE}/dois/${doiPath(a.doi || work.id)}`}]});
}
function normalizeCatalogPaper(paper) {
  return baseRecord({...paper, authors: (paper.authors || []).map(a => authorRecord(a.name, {orcid: extractOrcid(a.orcid), affiliation: affiliationText(a.affiliation), externalId: a.externalId, affiliationSources:a.affiliationSources}))});
}
function doiPath(doi) { return String(doi || '').split('/').map(encodeURIComponent).join('/'); }
function isScholarHost(hostname) { return /^scholar\.google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/i.test(hostname); }
function scholarInputURL(url, citationId) {
  if (!citationId) return undefined;
  const result = new URL('/citations', url.origin);
  result.searchParams.set('view_op', 'view_citation'); result.searchParams.set('citation_for_view', citationId);
  return result.href;
}
export function parsePaperInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return {kind: 'empty'};
  let url;
  try { url = new URL(raw); } catch { /* A title or bare identifier is normal. */ }
  if (url && isScholarHost(url.hostname)) {
    const citationId = url.searchParams.get('citation_for_view') || undefined;
    return {kind: 'scholar', citationId, inputUrl: scholarInputURL(url, citationId)};
  }
  const doi = normalizeDoi(raw);
  if (doi) return {kind: 'doi', doi, arxivId: arxivFromDoi(doi), inputUrl: `https://doi.org/${doi}`};
  const arxivId = normalizeArxivId(raw);
  if (arxivId) return {kind: 'arxiv', arxivId, doi: `10.48550/arxiv.${arxivId}`, inputUrl: `https://arxiv.org/abs/${arxivId}`};
  if (/^[\w-]+:[\w-]+$/.test(raw)) return {kind: 'scholar', citationId: raw};
  if (url) return {kind: 'unsupported-url'};
  const title = extractPastedPaperTitle(raw);
  return {kind: 'title', title, pastedText: /[\r\n]/.test(raw)};
}
export function extractPastedPaperTitle(input) {
  const raw = String(input ?? '').trim();
  const lines = raw.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
  const labeled = lines.find(x => /^(?:title|标题)\s*[:：]/i.test(x));
  if (labeled) return text(labeled.replace(/^(?:title|标题)\s*[:：]\s*/i, '')).slice(0, 600);
  // A copied page is only a search hint; returned candidates still require selection.
  const usable = lines.filter(x => !/^https?:\/\//i.test(x) && !/^(?:Google Scholar|Google 学术|Cited by|引用次数|Authors?\s*[:：]|作者\s*[:：]|doi\s*[:：]|arxiv\s*[:：])/i.test(x));
  return text(usable.find(x => x.length >= 20) || usable[0] || '').slice(0, 600);
}
function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
}
async function fetchJson(url, signal) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !API_HOSTS.has(endpoint.hostname)) throw new Error('Unsupported metadata endpoint');
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, {once: true});
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(endpoint.href, {headers: {Accept: 'application/json'}, mode: 'cors', credentials: 'omit', redirect: 'error', signal: controller.signal});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
async function loadCatalog() {
  if (!catalogPromise) catalogPromise = fetch(CATALOG_URL, {credentials: 'omit'}).then(r => r.ok ? r.json() : {papers: []}).then(c => Array.isArray(c.papers) ? c.papers : []).catch(() => []);
  return catalogPromise;
}
function findCatalogMatches(catalog, parsed, titleHint) {
  const wantedTitle = normalizePaperTitle(titleHint || parsed.title);
  return catalog.filter(p => {
    if (parsed.kind === 'scholar') return parsed.citationId && p.aliases?.scholarCitationIds?.includes(parsed.citationId);
    if (parsed.doi || parsed.arxivId) return Boolean((parsed.doi && normalizeDoi(p.doi) === parsed.doi) || (parsed.arxivId && normalizeArxivId(p.arxivId) === parsed.arxivId));
    return wantedTitle && [p.title, ...(p.aliases?.titles || [])].some(t => normalizePaperTitle(t) === wantedTitle);
  }).map(normalizeCatalogPaper).filter(Boolean);
}
function titleScore(title, query) {
  const a = normalizePaperTitle(title), b = normalizePaperTitle(query);
  if (!b) return 0;
  if (a === b) return 2;
  const aa = new Set(a.split(' ')), bb = new Set(b.split(' '));
  let shared = 0; for (const word of bb) if (aa.has(word)) shared++;
  return shared / Math.max(aa.size, bb.size, 1);
}
function relatedTitlesMatch(a, b) {
  if (normalizePaperTitle(a) === normalizePaperTitle(b)) return true;
  // Related versions can have small editorial title changes. Short or substantially
  // different titles require an exact match, even when a DOI relation is present.
  return [a,b].every(t=>normalizePaperTitle(t).split(' ').length>=6) && titleScore(a,b)>=0.85;
}
function uniqueAuthorMatches(original, related) {
  const matches = new Map(), used = new Set();
  for (let index=0;index<original.length;index++) {
    const person=original[index];
    const entries=related.map((other,i)=>({other,i}));
    const identifiers=person.orcid?entries.filter(({other})=>person.orcid===other.orcid):[];
    const possible=identifiers.length?identifiers:entries.filter(({other})=>{
      if (person.orcid && other.orcid) return person.orcid===other.orcid;
      return Boolean(nameMatchKind(person.name,other.name));
    });
    if (possible.length===1) matches.set(index,possible[0].i);
  }
  // A repeated or ambiguous name must not attach one affiliation to two people.
  for (const [index,relatedIndex] of matches) {
    if (used.has(relatedIndex)) {
      for (const [otherIndex,otherRelated] of matches) if (otherRelated===relatedIndex) matches.delete(otherIndex);
    } else used.add(relatedIndex);
  }
  return matches;
}
function relatedAuthorsMatch(original, related, matches) {
  return original.length>0 && related.length>0 && matches.size>=Math.ceil(Math.max(original.length,related.length)*0.8);
}
function relatedPublicationDois(work, arxivDoi) {
  const a=work?.attributes || work;
  const permitted=new Set(['IsVersionOf','IsPreprintOf','IsIdenticalTo']);
  return [...new Set((a?.relatedIdentifiers||[]).filter(r=>String(r.relatedIdentifierType).toUpperCase()==='DOI' && permitted.has(r.relationType)).map(r=>normalizeDoi(r.relatedIdentifier)).filter(doi=>doi && doi!==arxivDoi && !arxivFromDoi(doi)))].slice(0,2);
}
function openAlexAuthors(work) {
  return (Array.isArray(work?.authorships)?work.authorships:[]).map(a=>{
    const raw=affiliationText(a.raw_affiliation_strings);
    return authorRecord(a.raw_author_name || a.author?.display_name,{
      orcid:extractOrcid(a.author?.orcid),
      affiliation:raw || affiliationText((a.institutions||[]).map(i=>i.display_name))
    });
  }).filter(Boolean);
}
function mergeRelatedAffiliations(original, related, matches, source) {
  let added=0;
  const authors=original.authors.map((author,index)=>{
    const affiliation=related[matches.get(index)]?.affiliation;
    if (author.affiliation || !affiliation) return author;
    added++;
    return {...author,affiliation,affiliationSources:affiliationSourceList([source])};
  });
  return added ? {...original,authors,sources:sourceList([...original.sources,source])} : original;
}
async function enrichArxivAffiliations(candidate, dataCiteWork, signal) {
  let result=candidate;
  if (!result.authors.some(author=>!author.affiliation)) return result;
  for (const doi of relatedPublicationDois(dataCiteWork,candidate.doi)) {
    throwIfAborted(signal);
    const crossrefURL=`${CROSSREF}/works/${doiPath(doi)}`;
    let publication;
    try { publication=normalizeCrossrefWork((await fetchJson(crossrefURL,signal))?.message,crossrefURL); }
    catch { throwIfAborted(signal); continue; }
    if (!publication || publication.doi!==doi || !relatedTitlesMatch(candidate.title,publication.title)) continue;
    const matches=uniqueAuthorMatches(candidate.authors,publication.authors);
    if (!relatedAuthorsMatch(candidate.authors,publication.authors,matches)) continue;
    result=mergeRelatedAffiliations(result,publication.authors,matches,{name:'Crossref · related publication author affiliation',url:crossrefURL,year:publication.year});
    if (!result.authors.some(author=>!author.affiliation)) break;
    const openAlexURL=`${OPENALEX}/works/doi:${doiPath(doi)}`;
    let work;
    try { work=await fetchJson(openAlexURL,signal); }
    catch { throwIfAborted(signal); break; }
    if (!work || normalizeDoi(work.doi)!==doi || !relatedTitlesMatch(candidate.title,work.title || work.display_name)) break;
    const authors=openAlexAuthors(work),openAlexMatches=uniqueAuthorMatches(candidate.authors,authors);
    if (!relatedAuthorsMatch(candidate.authors,authors,openAlexMatches)) break;
    result=mergeRelatedAffiliations(result,authors,openAlexMatches,{name:'OpenAlex · related publication authorship',url:openAlexURL,year:recordYear(work.publication_year)});
    // One verified journal version is enough; never blend institutions from
    // additional versions of the publication into the same author preview.
    break;
  }
  return result;
}
export function rankAndDedupeCandidates(candidates, query = '') {
  const found = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const old = found.get(candidate.id);
    if (!old) found.set(candidate.id, {...candidate, authors: [...candidate.authors], sources: [...candidate.sources]});
    else {
      // Never deduplicate authors by display name; distinct people can share a name.
      if (candidate.authors.length > old.authors.length) old.authors = [...candidate.authors];
      old.sources = sourceList([...old.sources, ...candidate.sources]);
      old.doi ||= candidate.doi; old.arxivId ||= candidate.arxivId; old.year ||= candidate.year;
    }
  }
  return [...found.values()].sort((a, b) => titleScore(b.title, query) - titleScore(a.title, query) || a.title.localeCompare(b.title)).slice(0, RESULT_LIMIT);
}
function addInputURL(candidates, inputUrl) { return candidates.map(c => inputUrl ? {...c, inputUrl} : c); }
function addArxivAffiliationWarnings(candidates, warnings) {
  const papers=candidates.filter(paper=>paper.arxivId);
  const missing=papers.reduce((sum,paper)=>sum+paper.authors.filter(author=>!author.affiliation).length,0);
  if (missing) warnings.push(`有 ${missing} 位作者的论文机构尚未从公开元数据确认，请手动核对。`);
  if (papers.some(paper=>paper.authors.some(author=>author.affiliationSources?.some(source=>source.name.includes('related publication'))))) warnings.push('部分机构来自关联的期刊发表记录，年份可能与 arXiv 版本不同，请核对来源。');
}

export async function resolvePaper(input, {titleHint, signal} = {}) {
  throwIfAborted(signal);
  const parsed = parsePaperInput(input), warnings = [];
  if (parsed.kind === 'empty' && !text(titleHint)) return {candidates: [], warnings: ['请粘贴论文标题、DOI、arXiv 编号或 Google Scholar 引文链接。']};
  const catalog = await loadCatalog(); throwIfAborted(signal);
  const catalogMatches = findCatalogMatches(catalog, parsed, titleHint);
  if (catalogMatches.length) {
    if (parsed.kind === 'scholar') warnings.push('已从收录的论文记录识别此 Scholar 链接；请核对标题与作者。');
    addArxivAffiliationWarnings(catalogMatches,warnings);
    return {candidates: addInputURL(catalogMatches, parsed.inputUrl), warnings};
  }
  if (parsed.kind === 'scholar' && !text(titleHint)) return {candidates: [], warnings: ['此 Scholar 链接尚未收录，请在“补充论文标题”中填写完整标题后重试。']};
  if (parsed.kind === 'unsupported-url' && !text(titleHint)) return {candidates: [], warnings: ['暂不直接抓取此网址。请粘贴论文标题、DOI 或 arXiv 编号。']};
  const isIdentifier = parsed.kind === 'doi' || parsed.kind === 'arxiv';
  const query = titleHint ? extractPastedPaperTitle(titleHint) : parsed.title;
  if (!isIdentifier && (!query || query.length < 3)) return {candidates: [], warnings: ['请提供更完整的论文标题。']};
  if (parsed.kind === 'scholar') warnings.push('已按补充标题检索公开论文记录，请核对候选论文。');
  if (parsed.pastedText) warnings.push('已从粘贴内容提取检索词，请核对候选论文标题后再创建作者关系。');
  const crossrefURL = isIdentifier ? `${CROSSREF}/works/${doiPath(parsed.doi)}` : `${CROSSREF}/works?${new URLSearchParams({'query.title': query, rows: '6', select: 'DOI,title,author,issued,published,URL'})}`;
  const dataciteURL = isIdentifier ? `${DATACITE}/dois/${doiPath(parsed.doi)}` : `${DATACITE}/dois?${new URLSearchParams({query: `titles.title:"${query.replace(/["\\]/g, ' ')}"`, 'page[size]': '6'})}`;
  const outcomes = await Promise.allSettled([fetchJson(crossrefURL, signal), fetchJson(dataciteURL, signal)]);
  throwIfAborted(signal);
  const candidates = [], dataCiteWorks = [];
  if (outcomes[0].status === 'fulfilled' && outcomes[0].value) {
    const works = isIdentifier ? [outcomes[0].value.message] : outcomes[0].value.message?.items || [];
    candidates.push(...works.map(w => normalizeCrossrefWork(w, isIdentifier ? crossrefURL : undefined)).filter(Boolean));
  }
  if (outcomes[1].status === 'fulfilled' && outcomes[1].value) {
    const works = isIdentifier ? [outcomes[1].value.data] : outcomes[1].value.data || [];
    dataCiteWorks.push(...works);
    candidates.push(...works.map(w => normalizeDataCiteWork(w, isIdentifier ? dataciteURL : undefined)).filter(Boolean));
  }
  const ranked = rankAndDedupeCandidates(candidates, query);
  if (parsed.arxivId) {
    for (let index=0;index<ranked.length;index++) {
      const candidate=ranked[index];
      if (candidate.arxivId!==parsed.arxivId) continue;
      const work=dataCiteWorks.find(item=>{
        const paper=normalizeDataCiteWork(item);
        return paper?.arxivId===parsed.arxivId && relatedTitlesMatch(candidate.title,paper.title);
      });
      if (work) ranked[index]=await enrichArxivAffiliations(candidate,work,signal);
    }
  }
  throwIfAborted(signal);
  const resolved = addInputURL(ranked, parsed.inputUrl);
  addArxivAffiliationWarnings(resolved,warnings);
  if (outcomes.every(o => o.status === 'rejected')) warnings.push('公开元数据服务暂时无法连接；请稍后重试，或使用已收录示例。');
  else if (outcomes.some(o => o.status === 'rejected')) warnings.push('部分元数据服务暂时不可用，以下结果来自可连接的公开来源。');
  if (!resolved.length && !warnings.some(w => w.includes('无法连接'))) warnings.push('未找到可用论文记录；请核对标题或标识符。论文可能尚未被这些公开服务收录。');
  if (resolved.some(p => !p.authors.length)) warnings.push('部分候选没有作者元数据；请勿据此创建作者或合作关系。');
  if (resolved.some(p => p.authors.length > 100)) warnings.push('部分论文作者较多，创建合作关系前请核对作者列表及显示范围。');
  return {candidates: resolved, warnings};
}
