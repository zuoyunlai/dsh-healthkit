// 数据目录只有一处真源。
//
// 2026-11-16 踩了两次同类问题：bin 键、VERSION 常量都是「同一信息写死在多处，改一处漏另一处」。
// 数据目录原本散在 6 个模块里手写字符串，这次一并收口到这里，并自带一次旧目录迁移。
import fs from 'node:fs';
import path from 'node:path';
import { dshHome } from './util.mjs';

export const DATA_DIR_NAME = 'dsh-healthkit';
export const LEGACY_DIR_NAME = 'dsh-auditkit';
// 旧**包名**（不是目录名）。init 自检要认出「用老名字装过的」那一版，
// 但业务代码里仍不许裸写旧目录名——两者都在这里收口，守卫才能保持严格。
export const LEGACY_PACKAGE_NAME = 'dsh-auditkit';

// 迁移失败时回落旧目录（不丢历史），所以路径要能被覆盖。
let activeDirName = DATA_DIR_NAME;

export { dshHome };

export function dataDirName() { return activeDirName; }

export function dataDir(home) {
  return path.join(home || dshHome(), activeDirName);
}

/**
 * 把旧的 ~/.dsh/dsh-auditkit 整目录重命名成 dsh-healthkit（同盘 rename，原子）。
 * - 新目录已存在：不动（already）
 * - 两个都不存在：全新安装（fresh）
 * - rename 失败：回落继续用旧目录，并把错误报上去（failed），绝不半搬
 */
export function migrateLegacyDataDir(home) {
  const h = home || dshHome();
  const legacy = path.join(h, LEGACY_DIR_NAME);
  const target = path.join(h, DATA_DIR_NAME);
  if (fs.existsSync(target)) {
    activeDirName = DATA_DIR_NAME;
    return { status: 'already', dir: target };
  }
  if (!fs.existsSync(legacy)) {
    activeDirName = DATA_DIR_NAME;
    return { status: 'fresh', dir: target };
  }
  try {
    fs.renameSync(legacy, target);
    activeDirName = DATA_DIR_NAME;
    return { status: 'migrated', from: legacy, to: target };
  } catch (e) {
    activeDirName = LEGACY_DIR_NAME;
    return { status: 'failed', error: (e && e.message) || String(e), dir: legacy };
  }
}
