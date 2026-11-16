// 装载面瘦身：把「能力冗余 / 装载超限 / 记忆插件叠放」三件事，
// 从「体检报了个数」变成「具体关哪个、关掉损失什么」。
//
// 只读：只给候选和理由，不写 cordis.patch.yml——装配错了整个宿主起不来，
// 这一步必须留在人手里（和 audit_clean 同一个立场：永不替用户做不可逆动作）。
import path from 'node:path';
import { readJson } from './util.mjs';

var MEM_RE = /(memory|chronicle|mnemon|openviking|context|recall)/i;

function bundleDesc(profile, name) {
  var pj = readJson(path.join(profile.dir, 'node_modules', name, 'package.json'), null);
  return (pj && (pj.description || '')) || '';
}

export function analyze(facts) {
  var profiles = (facts && facts.profiles) || [];
  var caps = (facts && facts.capabilities) || {};
  var logs = (facts && facts.logs) || {};
  var redundancy = caps.redundancy || [];
  var maxBundles = (facts && facts.maxBundles) || 43;
  var served = typeof logs.servedPlugins === 'number' ? logs.servedPlugins : null;

  var thirdParty = [];
  var mem = [];
  profiles.forEach(function (p) {
    (p.thirdPartyBundles || []).forEach(function (b) {
      if (thirdParty.indexOf(b) < 0) thirdParty.push({ name: b, profile: p.name, desc: bundleDesc(p, b) });
    });
    (p.bundles || []).forEach(function (b) {
      if (MEM_RE.test(b) && !mem.some(function (m) { return m.name === b; })) {
        mem.push({ name: b, profile: p.name, desc: bundleDesc(p, b) });
      }
    });
  });

  var groups = redundancy.map(function (r) {
    // 主备怎么定：按「核心度」排序，而不是按字母——名字里就带 tag 的最像主力实现。
    // 其余一律降级成「候选（待你确认用途）」，不替你判断该关谁。
    var score = function (n) {
      var p = thirdParty.filter(function (x) { return x.name === n; })[0];
      var d = (p && p.desc) || '';
      var s = 0;
      if (n.toLowerCase().indexOf(r.tag) > -1) s += 3;
      if (d.toLowerCase().indexOf(r.tag) > -1) s += 1;
      return s;
    };
    var ranked = r.plugins.slice().sort(function (a, b) { return score(b) - score(a); });
    var keep = ranked[0];
    var drop = ranked.slice(1);
    return {
      tag: r.tag,
      count: r.count,
      keep: keep,
      drop: drop,
      plugins: r.plugins.map(function (n) {
        var row = thirdParty.filter(function (x) { return x.name === n; })[0];
        return { name: n, desc: row ? row.desc : '' };
      }),
    };
  });

  var suggestions = [];
  if (served !== null && served > maxBundles) {
    suggestions.push('服务插件 ' + served + ' 个，超过宿主 bundles 上限 ' + maxBundles + '：优先砍「同能力多实现」，别砍基础设施（ui/privacy/permissions）');
  }
  groups.forEach(function (g) {
    suggestions.push(g.tag + ' 有 ' + g.count + ' 个实现：主力看着像 ' + g.keep + '；其余 ' + g.drop.join('、') + ' 是候选，关之前先确认它们的用途');
  });
  if (mem.length >= 3) {
    suggestions.push(mem.length + ' 套记忆/上下文插件同时在装：' + mem.map(function (m) { return m.name; }).join('、') + '——每轮都会注入，定主备后关掉其余');
  }
  if (!suggestions.length) suggestions.push('没有发现需要瘦身的装载面（无冗余组、未超上限、记忆插件 ≤2 套）');

  return {
    served: served,
    maxBundles: maxBundles,
    thirdParty: thirdParty,
    memory: mem,
    groups: groups,
    suggestions: suggestions,
  };
}

export function render(r) {
  var L = [];
  L.push('装载面：' + (r.served === null ? '服务插件数未知' : '服务插件 ' + r.served + ' 个') + ' / bundles 上限 ' + r.maxBundles + ' · 第三方 bundle ' + r.thirdParty.length + ' 个');
  L.push('（按名字/描述粗筛，误判常见——每组只给「看着像主力」的那个，其余都要你自己确认用途）');
  L.push('');
  if (r.groups.length) {
    L.push('能力冗余（同能力多实现，优先从这里砍）：');
    r.groups.forEach(function (g) {
      L.push('  [' + g.tag + '] ' + g.count + ' 个实现 —— 建议留 ' + g.keep);
      g.plugins.forEach(function (p) {
        L.push('     ' + (p.name === g.keep ? '· 留  ' : '  ？  ') + p.name + (p.desc ? '  — ' + p.desc.slice(0, 70) : ''));
      });
    });
    L.push('');
  }
  if (r.memory.length) {
    L.push('记忆/上下文插件（每轮固定注入）：');
    r.memory.forEach(function (m) { L.push('  · ' + m.name + (m.desc ? '  — ' + m.desc.slice(0, 60) : '')); });
    L.push('');
  }
  L.push('建议：');
  r.suggestions.forEach(function (s, i) { L.push('  ' + (i + 1) + '. ' + s); });
  L.push('');
  L.push('怎么关（只给形状，不替你写）：在 profile 的 cordis.patch.yml 里加一条 disable 记录，');
  L.push('id 用 bundle 名，形状照该文件里现有条目；改完重启宿主，再跑一次 audit_run 看 R15/R20 是否消失。');
  L.push('注意：关掉前确认没有别的插件依赖它（audit_explain 看 R1/R22 的证据）。');
  return L.join('\n');
}
