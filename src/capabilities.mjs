import path from 'node:path';
import { readJson } from './util.mjs';

// 只保留「会抢同一资源/工具位」的高信号能力；memory 由 R16 专管，避免重复计罚
var TAGS = [
  { key: 'image', re: /(image-gen|^dsh-image|image|vision|ocr|modlens)/i },
  { key: 'search', re: /(search|fetch|crawl|scrap)/i },
  { key: 'browser', re: /(browser|ego)/i },
];

export function tagProfile(profile) {
  var out = [];
  var list = (profile.bundles || []).filter(function (b) { return b.indexOf('@deepseek-ai/') !== 0; });
  for (var i = 0; i < list.length; i++) {
    var name = list[i];
    var pj = readJson(path.join(profile.dir, 'node_modules', name, 'package.json'), null);
    var text = name + ' ' + ((pj && ((pj.description || '') + ' ' + ((pj.keywords || []).join(' ')))) || '');
    var hits = TAGS.filter(function (t) { return t.re.test(text); }).map(function (t) { return t.key; });
    if (hits.length) out.push({ name: name, tags: hits });
  }
  return out;
}

export function redundancy(tagged, threshold) {
  var byTag = {};
  tagged.forEach(function (p) { p.tags.forEach(function (t) { (byTag[t] = byTag[t] || []).push(p.name); }); });
  return Object.keys(byTag).filter(function (t) { return byTag[t].length >= (threshold || 3); })
    .map(function (t) { return { tag: t, count: byTag[t].length, plugins: byTag[t] }; });
}
