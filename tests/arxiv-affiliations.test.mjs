import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePaper} from '../paper-resolver.mjs';
import {previewPaperImport, sanitizePaperDocument, rebuildPaperGraph} from '../paper-importer.mjs';

// Compact excerpts of the public records for arXiv:2002.00281 and its Nature
// publication. Include only fields consumed by the resolver, with no live I/O.
const ARXIV_ID = '2002.00281';
const ARXIV_DOI = '10.48550/arxiv.2002.00281';
const JOURNAL_DOI = '10.1038/s41586-020-03070-1';
const TITLE = 'Parallel convolution processing using an integrated photonic tensor core';
const JOURNAL_TITLE = 'Parallel convolutional processing using an integrated photonic tensor core';
const OXFORD = 'Department of Materials, University of Oxford, Oxford, UK';
const EPFL = 'Laboratory of Photonics and Quantum Measurements, Swiss Federal Institute of Technology Lausanne (EPFL), Lausanne, Switzerland';
const MUNSTER = 'Institute of Physics, University of Münster, Münster, Germany';
const IBM = 'IBM Research Europe, Rüschlikon, Switzerland';
const NATHAN_ORCID = '0000-0003-2552-9376';
const authorRows = [
  ['Johannes', 'Feldmann', 'J. Feldmann', MUNSTER],
  ['Nathan', 'Youngblood', 'N. Youngblood', OXFORD],
  ['Maxim', 'Karpov', 'M. Karpov', EPFL],
  ['Helge', 'Gehring', 'H. Gehring', MUNSTER],
  ['Xuan', 'Li', 'X. Li', OXFORD],
  ['Maik', 'Stappers', 'M. Stappers', MUNSTER],
  ['Manuel Le', 'Gallo', 'M. Le Gallo', IBM],
  ['Xin', 'Fu', 'X. Fu', EPFL],
  ['Anton', 'Lukashchuk', 'A. Lukashchuk', EPFL],
  ['Arslan', 'Raja', 'A. S. Raja', EPFL],
  ['Junqiu', 'Liu', 'J. Liu', EPFL],
  // The extra leading initial cannot establish identity from the arXiv name.
  ['David', 'Wright', 'C. D. Wright', 'Department of Engineering, University of Exeter, Exeter, UK'],
  ['Abu', 'Sebastian', 'A. Sebastian', `${IBM}. contact@example.edu`],
  ['Tobias', 'Kippenberg', 'T. J. Kippenberg', EPFL],
  ['Wolfram', 'Pernice', 'W. H. P. Pernice', MUNSTER],
  ['Harish', 'Bhaskaran', 'H. Bhaskaran', OXFORD]
];
const names = authorRows.map(([given, family]) => `${given} ${family}`);

function fixtures() {
  return {
    datacite: {data: {attributes: {
      doi: ARXIV_DOI, url: `https://arxiv.org/abs/${ARXIV_ID}`,
      titles: [{title: TITLE}], publicationYear: 2020,
      creators: authorRows.map(([givenName, familyName]) => ({givenName, familyName, affiliation: []})),
      relatedIdentifiers: [{relationType: 'IsVersionOf', relatedIdentifierType: 'DOI', relatedIdentifier: JOURNAL_DOI}]
    }}},
    crossref: {message: {
      DOI: JOURNAL_DOI, title: [JOURNAL_TITLE], published: {'date-parts': [[2021]]},
      author: authorRows.map(([, , name], index) => {
        const parts = name.split(' '), family = parts.pop();
        return {given: parts.join(' '), family, affiliation: [], ...(index === 1 ? {ORCID: `https://orcid.org/${NATHAN_ORCID}`} : {})};
      })
    }},
    openalex: {
      doi: `https://doi.org/${JOURNAL_DOI}`, title: JOURNAL_TITLE, publication_year: 2021,
      authorships: authorRows.map(([, , name, affiliation], index) => ({
        raw_author_name: name, author: {display_name: name, ...(index === 1 ? {orcid: `https://orcid.org/${NATHAN_ORCID}`} : {})},
        raw_affiliation_strings: [affiliation + (index === 12 ? '. corresponding.author@example.edu' : '')]
      }))
    }
  };
}

const originalFetch = globalThis.fetch;
function mockMetadata(records = fixtures(), {unavailable = false, cancel} = {}) {
  const calls = [], unexpected = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('/paper-catalog.json')) return new Response(JSON.stringify({papers: []}));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.mode, 'cors');
    assert.equal(options.redirect, 'error');
    if (url.hostname === 'api.datacite.org' && url.pathname === `/dois/${ARXIV_DOI}`) return new Response(JSON.stringify(records.datacite));
    if (url.hostname === 'api.crossref.org' && url.pathname === `/works/${ARXIV_DOI}`) return new Response('', {status: 404});
    if (url.hostname === 'api.crossref.org' && url.pathname === `/works/${JOURNAL_DOI}`) {
      if (cancel) {cancel.abort(new DOMException('Cancelled by user', 'AbortError')); throw cancel.signal.reason;}
      if (unavailable) throw new TypeError('Metadata service unavailable');
      return new Response(JSON.stringify(records.crossref));
    }
    if (url.hostname === 'api.openalex.org' && url.pathname === `/works/doi:${JOURNAL_DOI}`) {
      if (unavailable) throw new TypeError('Metadata service unavailable');
      return new Response(JSON.stringify(records.openalex));
    }
    unexpected.push(url.href);
    throw new Error(`Unexpected metadata request: ${url.href}`);
  };
  return {calls, unexpected};
}
async function lookup(records, options) {
  const mock = mockMetadata(records, options);
  const result = await resolvePaper(`https://arxiv.org/abs/${ARXIV_ID}v2`);
  assert.deepEqual(mock.unexpected, []);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].authors.map(author => author.name), names);
  return {...result, calls: mock.calls};
}

try {
  await test('arXiv author identities survive journal affiliation enrichment', async () => {
    const {candidates: [paper], warnings, calls} = await lookup(fixtures());
    assert.equal(paper.id, `arxiv:${ARXIV_ID}`);
    assert.equal(paper.doi, ARXIV_DOI);
    assert.equal(paper.title, TITLE);
    assert.equal(paper.year, 2020);
    assert.equal(paper.authors.filter(author => author.affiliation).length, 15);
    assert.equal(paper.authors.find(author => author.name === 'David Wright').affiliation, undefined);
    assert.equal(paper.authors.find(author => author.name === 'Xuan Li').affiliation, OXFORD);
    assert.equal(paper.authors.find(author => author.name === 'Maxim Karpov').affiliation, EPFL);
    for (const author of paper.authors.filter(author => author.affiliation)) {
      assert.ok(!author.affiliation.includes('@'));
      assert.equal(author.affiliationSources[0].year, 2021);
      assert.match(author.affiliationSources[0].name, /related publication/);
    }
    assert.match(warnings.join(' '), /1 位作者/);
    assert.equal(calls.filter(url => url.hostname === 'api.openalex.org').length, 1);
    assert.equal(calls.filter(url => url.hostname === 'api.crossref.org').length, 2);
  });

  await test('unrelated titles, publication DOIs, and author lists cannot supply affiliations', async () => {
    const cases = [
      records => {records.crossref.message.title = ['An unrelated study of a completely different research problem'];},
      records => {records.crossref.message.DOI = '10.1000/wrong-publication';},
      records => {records.crossref.message.author = names.map((name, index) => ({given: 'Other', family: `Person${index}`}));},
      records => {records.openalex.doi = 'https://doi.org/10.1000/wrong-publication';},
      records => {records.openalex.title = 'An unrelated study of a completely different research problem';},
      records => {records.openalex.authorships = names.map((name, index) => ({raw_author_name: `Other Person${index}`, raw_affiliation_strings: [OXFORD]}));}
    ];
    for (const change of cases) {
      const records = fixtures(); change(records);
      const {candidates: [paper]} = await lookup(records);
      assert.ok(paper.authors.every(author => !author.affiliation));
    }
  });

  await test('conflicting ORCIDs and ambiguous same-name authors stay unresolved', async () => {
    const conflict = fixtures();
    conflict.datacite.data.attributes.creators[1].nameIdentifiers = [{nameIdentifierScheme: 'ORCID', nameIdentifier: '0000-0002-1825-0097'}];
    const {candidates: [paper]} = await lookup(conflict);
    assert.equal(paper.authors[1].affiliation, undefined);
    const ambiguous = fixtures();
    ambiguous.openalex.authorships[1].raw_author_name = ambiguous.openalex.authorships[0].raw_author_name;
    delete ambiguous.openalex.authorships[1].author.orcid;
    const {candidates: [other]} = await lookup(ambiguous);
    assert.equal(other.authors[0].affiliation, undefined);
  });

  await test('supplemental failures retain the original author list; cancellation aborts cleanly', async () => {
    const records = fixtures(), before = structuredClone(records);
    const {candidates: [paper], warnings} = await lookup(records, {unavailable: true});
    assert.ok(paper.authors.every(author => !author.affiliation));
    assert.ok(warnings.length > 0);
    const controller = new AbortController(), mock = mockMetadata(records, {cancel: controller});
    await assert.rejects(resolvePaper(`https://arxiv.org/abs/${ARXIV_ID}`, {signal: controller.signal}), error => error.name === 'AbortError');
    assert.deepEqual(mock.unexpected, []);
    assert.deepEqual(records, before, 'Failed and cancelled lookups must not mutate their source records');
  });

  await test('paper institutions retain provenance and manual corrections without replacing current profiles', async () => {
    const {candidates: [paper]} = await lookup(fixtures());
    const nodes = names.map((name, index) => ({
      id: `person-${index}`, name, aliases: [name], entityType: 'person', stub: false,
      affiliation: 'Current employer', role: 'Faculty', affiliationType: 'University',
      academicHistory: [{type: 'phd', institution: 'Existing graduate university', title: 'PhD', startDate: '2010', endDate: '2015', ongoing: false, endDateType: 'unspecified', sourceSection: 'Education', sourceUrl: '', retrievedAt: ''}], records: [], rows: []
    }));
    const base = {nodes, edges: [], papers: [], meta: {}, edgeTypes: []};
    const matches = Object.fromEntries(nodes.map((node, index) => [`0:${index}`, {nodeId: node.id, identity: {name: node.name, orcid: ''}}]));
    const imported = previewPaperImport(base, {papers: [paper], matches});
    assert.deepEqual(imported.issues, []);
    const checkProfile = graph => {
      const node = graph.nodes.find(item => item.id === 'person-4');
      assert.equal(node.affiliation, 'Current employer');
      assert.equal(node.role, 'Faculty');
      assert.equal(node.affiliationType, 'University');
      assert.deepEqual(node.academicHistory, nodes[4].academicHistory);
      return node;
    };
    const node = checkProfile(imported.graph);
    assert.equal(node.publicationAffiliations[0].name, OXFORD);
    assert.equal(node.publicationAffiliations[0].affiliationSources[0].year, 2021);
    const corrected = structuredClone(paper);
    corrected.authors[4] = {...corrected.authors[4], affiliation: 'User verified paper institution', affiliationEdited: true};
    const correction = previewPaperImport(imported.graph, {papers: [corrected], matches});
    assert.deepEqual(correction.issues, []);
    const replay = previewPaperImport(correction.graph, {papers: [paper], matches});
    const correctedAuthor = replay.graph.papers[0].authors[4];
    assert.equal(correctedAuthor.affiliation, 'User verified paper institution');
    assert.equal(correctedAuthor.affiliationEdited, true);
    assert.equal(correctedAuthor.affiliationSources, undefined, 'A manual value must not claim the automatic source');
    const missing = structuredClone(paper);
    delete missing.authors[4].affiliation; delete missing.authors[4].affiliationSources;
    const retained = previewPaperImport(replay.graph, {papers: [missing], matches});
    assert.equal(retained.graph.papers[0].authors[4].affiliation, 'User verified paper institution');
    checkProfile(retained.graph);
    const queued = sanitizePaperDocument(JSON.parse(JSON.stringify({papers: retained.graph.papers, matches})));
    assert.equal(queued.papers[0].authors[4].affiliationEdited, true);
    assert.equal(queued.papers[0].authors[2].affiliationSources[0].year, 2021);
    const rebuilt = rebuildPaperGraph(structuredClone(retained.graph));
    assert.equal(checkProfile(rebuilt).publicationAffiliations[0].affiliationEdited, true);
  });
} finally {
  globalThis.fetch = originalFetch;
}
