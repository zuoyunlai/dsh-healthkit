// 数据目录迁移测试：rename 语义 + 三种前置状态。
// 这段代码会动用户数据，所以必须先用临时目录把行为钉死。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyDataDir, dataDir, DATA_DIR_NAME } from '../src/paths.mjs';

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-mig-'));

// 1) 旧目录存在、新目录不存在 → 整目录搬过去，内容不丢
{
  const home = mkHome();
  const legacy = path.join(home, 'dsh-auditkit');
  fs.mkdirSync(path.join(legacy, 'trash', '20260101-000000'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'history.jsonl'), '{"score":4.25}\n');
  fs.writeFileSync(path.join(legacy, 'retirements.json'), '{"R21a#x":{}}\n');

  const r = migrateLegacyDataDir(home);
  assert.equal(r.status, 'migrated');
  assert.ok(!fs.existsSync(legacy), '旧目录应已不存在');
  const target = path.join(home, DATA_DIR_NAME);
  assert.ok(fs.existsSync(path.join(target, 'history.jsonl')));
  assert.ok(fs.existsSync(path.join(target, 'retirements.json')));
  assert.ok(fs.existsSync(path.join(target, 'trash', '20260101-000000')));
  assert.equal(dataDir(home), target);
  fs.rmSync(home, { recursive: true, force: true });
}

// 2) 两个都在 → 不动新目录（already），旧目录原样留着
{
  const home = mkHome();
  fs.mkdirSync(path.join(home, 'dsh-auditkit'));
  fs.writeFileSync(path.join(home, 'dsh-auditkit', 'old.txt'), 'x');
  fs.mkdirSync(path.join(home, DATA_DIR_NAME));
  fs.writeFileSync(path.join(home, DATA_DIR_NAME, 'new.txt'), 'y');

  const r = migrateLegacyDataDir(home);
  assert.equal(r.status, 'already');
  assert.ok(fs.existsSync(path.join(home, DATA_DIR_NAME, 'new.txt')));
  assert.ok(fs.existsSync(path.join(home, 'dsh-auditkit', 'old.txt')));
  fs.rmSync(home, { recursive: true, force: true });
}

// 3) 全新安装 → fresh，什么都不创建
{
  const home = mkHome();
  const r = migrateLegacyDataDir(home);
  assert.equal(r.status, 'fresh');
  assert.ok(!fs.existsSync(path.join(home, 'dsh-auditkit')));
  fs.rmSync(home, { recursive: true, force: true });
}

// 4) 源码里不许再手写旧目录名（paths.mjs 的 LEGACY_DIR_NAME 除外）
{
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const files = ['index.js', ...fs.readdirSync(path.join(here, '..', 'src')).filter(f => f.endsWith('.mjs') && f !== 'paths.mjs')];
  for (const f of files) {
    const p = f === 'index.js' ? path.join(here, '..', f) : path.join(here, '..', 'src', f);
    const src = fs.readFileSync(p, 'utf8');
    // 只认「旧目录名这个字符串」出现在业务代码里，不管带不带引号——
    // 0.4.5 就是因为只拦了带引号的写法，漏掉了工具描述里裸写的那一处。
    assert.ok(!src.includes('dsh-auditkit'), f + ' 仍写死旧数据目录名，请用 paths.mjs 的 dataDir() / LEGACY_DIR_NAME');
  }
}

console.log('migrate-guard: 4/4 通过');
