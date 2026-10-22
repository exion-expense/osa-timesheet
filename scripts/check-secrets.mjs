// ตรวจก่อน push/build: ห้ามมีคีย์ลับหรือข้อมูลส่วนบุคคลหลุดเข้า repo
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ใช้รายชื่อไฟล์จาก git (ไม่นับไฟล์ที่ .gitignore) ถ้ายังไม่ใช่ git repo ให้ไล่ทุกไฟล์
function listFiles() {
  try {
    return execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')
  } catch {
    const out = []
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git'].includes(e.name) || e.name === '.env.local') continue
        const p = d === '.' ? e.name : join(d, e.name)
        e.isDirectory() ? walk(p) : out.push(p)
      }
    }
    walk('.')
    return out
  }
}
const files = listFiles().filter((f) => f && !f.startsWith('node_modules/') && !f.endsWith('package-lock.json') && f !== 'scripts/check-secrets.mjs')

const rules = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/service_role/i, 'คำว่า service_role (อาจเป็นคีย์ลับ)'],
  [/postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@/i, 'รหัสผ่านฐานข้อมูลใน connection string'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b\d-\d{4}-\d{5}-\d{2}-\d\b/, 'เลขบัตรประชาชน'],
  [/(?<![\d.])[1-8]\d{12}(?![\d.])/, 'เลข 13 หลัก (อาจเป็นเลขบัตรประชาชน)'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/\bsbp_[A-Za-z0-9]{30,}/, 'Supabase access token'],
]
const allow = new Set(['supabase/migrations/0001_init.sql', 'supabase/local/stub.sql', 'supabase/tests/test.sql', 'src/lib/supabase.ts', 'vite.config.ts', '.github/workflows/deploy.yml', 'README.md', 'SECURITY.md'])
let bad = 0
for (const f of files) {
  if (/\.(env|pem|key|pdf|xlsx?|csv)$/i.test(f) || /(^|\/)\.env(\.|$)/.test(f)) {
    if (f !== '.env.example') {
      console.error(`✗ ห้าม commit ไฟล์นี้: ${f}`)
      bad++
    }
    continue
  }
  let text
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  // JWT แบบเก่า: คำว่า service_role ถูก base64 ไว้ ต้องถอดดู
  for (const tok of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString())
      if (payload.role === 'service_role') {
        console.error(`✗ ${f}: พบ service_role JWT`)
        bad++
      }
    } catch {
      /* not a JWT */
    }
  }
  for (const [re, label] of rules) {
    if (re.test(text) && !(allow.has(f) && label.startsWith('คำว่า service_role'))) {
      console.error(`✗ ${f}: พบ ${label}`)
      bad++
    }
  }
}
if (bad) {
  console.error(`\nพบปัญหา ${bad} รายการ — แก้ก่อน push`)
  process.exit(1)
}
console.log(`✓ ตรวจ ${files.length} ไฟล์ ไม่พบคีย์ลับ`)
