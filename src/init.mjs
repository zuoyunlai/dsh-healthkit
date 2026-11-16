// init：一键接入前的「体检式自检」。
//
// 只做三件事：报环境、报装没装、报还差哪一步。**不改任何文件**——
// 改 profile 的代价太高（装配错了整个宿主起不来），所以这里只打印可粘贴的片段。
import fs from 'node:fs';
import path from 'node:path';
import { dshHome, dataDir, LEGACY_PACKAGE_NAME } from './paths.mjs';

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

export function inspect(home) {
  const h = home || dshHome();
  const out = { home: h, dataDir: dataDir(h), profiles: [], steps: [], ready: false };
  let names = [];
  try {
    names = fs.readdirSync(path.join(h, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.charAt(0) !== '.')
      // 只认真正的 profile：有 package.json。缓存目录（.dsh-project-memory 等）一律排除。
      .filter((d) => fs.existsSync(path.join(h, 'profiles', d.name, 'package.json')))
      .map((d) => d.name);
  } catch (e) { names = []; }

  for (const name of names) {
    const dir = path.join(h, 'profiles', name);
    const pkg = readJson(path.join(dir, 'package.json'), {});
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const spec = deps['dsh-healthkit'] || (deps[LEGACY_PACKAGE_NAME] || null);
    const bundles = ((pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []);
    const patch = readText(path.join(dir, 'cordis.patch.yml'));
    const hasPatchEntry = /-\s*id:\s*dsh-healthkit\b/.test(patch);
    const installed = !!spec;
    out.profiles.push({
      name,
      installed,
      spec: spec || '',
      bundled: bundles.indexOf('dsh-healthkit') > -1,
      patchEntry: hasPatchEntry,
    });
    if (installed && bundles.indexOf('dsh-healthkit') < 0) {
      out.steps.push('profile ' + name + ' 装了包但没进 bundles：在 package.json 的 dsh.profile.bundles 里加 "dsh-healthkit"');
    }
  }

  const anyInstalled = out.profiles.some((p) => p.installed);
  const anyBundled = out.profiles.some((p) => p.bundled);
  out.ready = anyInstalled && anyBundled;

  if (!out.profiles.length) {
    out.steps.push('没找到任何 profile：先确认 DSH_HOME（当前 ' + h + '）是对的');
  } else if (!anyInstalled) {
    const target = out.profiles[0].name;
    out.steps.push('装到 profile：dsh plugin --profile ' + target + ' add dsh-healthkit');
    out.steps.push('（或先全局装：npm i -g dsh-healthkit，再用 CLI 跑 dsh-healthkit）');
  } else if (!anyBundled) {
    out.steps.push('已装但未挂载：把 "dsh-healthkit" 加进 profile package.json 的 dsh.profile.bundles');
  }
  if (out.ready) {
    out.steps.push('已就绪：重启宿主后，工具面会出现 audit_run / audit_report / audit_clean / audit_trend / audit_findings / audit_explain / audit_plan / audit_trim / audit_capabilities / audit_retire / audit_diff / audit_verify / audit_check / audit_recommend（共 14 个）');
    out.steps.push('先跑一次基线：audit_report（报告落在会话工作区）');
  }
  return out;
}

export function renderInit(r) {
  const L = [];
  L.push('DSH_HOME  ' + r.home);
  L.push('数据目录  ' + r.dataDir);
  L.push('');
  if (!r.profiles.length) {
    L.push('（没有 profile）');
  } else {
    L.push('profile            安装   挂载   配置条目');
    for (const p of r.profiles) {
      L.push(
        p.name.padEnd(19) +
        (p.installed ? ' 是   ' : ' 否   ') +
        (p.bundled ? ' 是    ' : ' 否    ') +
        (p.patchEntry ? '有' : '无'),
      );
      if (p.installed && p.spec) L.push('   ' + p.name + ' → ' + p.spec);
    }
  }
  L.push('');
  if (r.steps.length) {
    L.push('下一步：');
    r.steps.forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s));
  } else {
    L.push('没有待办。');
  }
  return L.join('\n');
}
