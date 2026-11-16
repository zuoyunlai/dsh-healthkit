// 测试环境助手：让「依赖真实 DSH 安装」的测试与「纯离线」的测试分开。
//
// 2026-11-16 踩过：CI（ubuntu runner）上没有 ~/.dsh，依赖真实环境的测试必然红。
// 所以这里给两种环境：
//   makeTempHome()  —— 造一个最小假 HOME，给形状类测试用（离线可跑）
//   hasRealInstall() —— 探测本机是否真有 DSH 安装；没有就 SKIP 而不是 FAIL
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 造一个最小假 HOME：一个 profile、装了一个未挂载的第三方包（会产生 R1）。
// withHealthkit=true 时再把 dsh-healthkit 装上并挂载 —— init 的「已就绪」分支需要它。
export function makeTempHome(prefix, withHealthkit) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'healthkit-test-'));
  const dir = path.join(home, 'profiles', 'p1');
  fs.mkdirSync(path.join(dir, 'node_modules', 'some-third-party-pkg'), { recursive: true });
  const deps = { 'some-third-party-pkg': '^1.0.0' };
  const bundles = ['@deepseek-ai/dsh-base'];
  if (withHealthkit) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'dsh-healthkit'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dsh-healthkit', 'package.json'), JSON.stringify({
      name: 'dsh-healthkit', version: '0.0.0-test',
    }));
    deps['dsh-healthkit'] = 'link:E:/somewhere/dsh-healthkit';
    bundles.push('dsh-healthkit');
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-p1', private: true,
    dependencies: deps,
    dsh: { profile: { bundles: bundles } },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'node_modules', 'some-third-party-pkg', 'package.json'), JSON.stringify({
    name: 'some-third-party-pkg', version: '1.0.0', description: 'A third party plugin',
  }));
  return home;
}

// 本机是否真有 DSH 安装（profile 目录存在且有 profile）
export function hasRealInstall() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  try {
    const names = fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.charAt(0) !== '.')
      .filter((d) => fs.existsSync(path.join(home, 'profiles', d.name, 'package.json')));
    return names.length > 0;
  } catch (e) {
    return false;
  }
}

export function skip(reason) {
  console.log('SKIP ' + reason);
}
