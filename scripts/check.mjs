// Repository checks for a DeepSeek Harness bundle.
//
// Everything here would otherwise only fail at install or load time: a `files`
// entry pointing at a file that does not exist, a locale dictionary missing a
// key the rail uses, a display asset the Plugin Manager cannot read.
//
//   node scripts/check.mjs
//
// Dependency-free on purpose: the bundle itself ships no runtime dependencies,
// so checking it must not need any either.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const notes = []

/** Record one check result. */
function check(label, ok, detail) {
  if (ok) notes.push(`✓ ${label}`)
  else failures.push(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** Read and parse one JSON file relative to the package root. */
function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
}

/**
 * Resolve one `files` entry, including a single `*` segment.
 * @returns {string[]} matched paths, empty when nothing matches.
 */
function resolveEntry(entry) {
  const segments = entry.split('/')
  const last = segments[segments.length - 1]
  const parent = join(ROOT, ...segments.slice(0, -1))
  if (!last.includes('*')) return existsSync(join(ROOT, entry)) ? [entry] : []
  if (!existsSync(parent)) return []
  const pattern = new RegExp(`^${last.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return readdirSync(parent)
    .filter((name) => pattern.test(name))
    .map((name) => [...segments.slice(0, -1), name].join('/'))
}

/** Collect the leaf key paths of a nested object. */
function keyPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix === '' ? key : `${prefix}.${key}`))
}

// --- manifest -------------------------------------------------------------

const pkg = readJson('package.json')
check('package.json parses', true)
check('name is scoped and lowercase', /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/.test(pkg.name ?? ''), pkg.name)
check('type is module', pkg.type === 'module', pkg.type)
check('private is set (a bundle, not an npm package)', pkg.private === true, String(pkg.private))

const exportsMap = pkg.exports ?? {}
for (const subpath of ['.', './client', './locale/*.json', './icon']) {
  check(`exports "${subpath}"`, typeof exportsMap[subpath] === 'string', String(exportsMap[subpath]))
}

// --- bundle patch ---------------------------------------------------------

const patchPath = pkg.dsh?.bundle?.patch
check('dsh.bundle.patch is declared', typeof patchPath === 'string', String(patchPath))
if (typeof patchPath === 'string' && existsSync(join(ROOT, patchPath))) {
  const patch = readFileSync(join(ROOT, patchPath), 'utf8')
  check('patch names this package', patch.includes(`'${pkg.name}'`) || patch.includes(`"${pkg.name}"`))
  check('patch declares at least one row id', /^\s*-\s+id:\s*\S+/m.test(patch))
}

// --- client half ----------------------------------------------------------

const client = pkg.dsh?.client
check('dsh.client is declared', client !== undefined)
check('dsh.client.platform is "web"', client?.platform === 'web', String(client?.platform))
check('dsh.client.immediately is boolean', typeof client?.immediately === 'boolean', String(client?.immediately))
check('dsh.client.inject is a string array', Array.isArray(client?.inject) && client.inject.every((id) => typeof id === 'string'))
if (existsSync(join(ROOT, 'client.js'))) {
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8')
  check('client registers through __ModuleLoader__', source.includes('__ModuleLoader__.load('))
  check('client registers under the package name', source.includes(`id: '${pkg.name}'`))
  // The documented rule: never import a Harness Client package as a module.
  check('client does not require a Harness Client package', !/require\(\s*['"]@deepseek-ai\//.test(source))
}

// --- shipped files --------------------------------------------------------

const files = pkg.files ?? []
check('files is a non-empty array', files.length > 0)
for (const entry of files) {
  check(`files entry "${entry}" resolves`, resolveEntry(entry).length > 0)
}

// --- locales --------------------------------------------------------------

const localeDir = join(ROOT, 'locale')
const locales = existsSync(localeDir)
  ? readdirSync(localeDir).filter((name) => name.endsWith('.json'))
  : []
check('at least one locale ships', locales.length > 0)
const dictionaries = locales.map((name) => ({ name, data: readJson(`locale/${name}`) }))
for (const { name, data } of dictionaries) {
  check(`locale/${name} has meta.title and meta.description`, typeof data.meta?.title === 'string' && typeof data.meta?.description === 'string')
}
const reference = dictionaries[0]
for (const { name, data } of dictionaries.slice(1)) {
  const wanted = new Set(keyPaths(reference.data))
  const missing = keyPaths(data).filter((key) => !wanted.has(key))
  check(`locale/${name} has the same keys as locale/${reference.name}`, missing.length === 0, missing.join(', '))
}

// --- display assets -------------------------------------------------------

const detail = reference.data.meta?.detail
if (detail !== undefined) {
  check(`detail document "${detail}" exists`, existsSync(join(ROOT, detail)))
}

const icon = readFileSync(join(ROOT, 'icon.svg'), 'utf8')
check('icon.svg parses as an svg root', icon.trimStart().startsWith('<svg'))
check('icon.svg is under 256 KiB', statSync(join(ROOT, 'icon.svg')).size < 256 * 1024)

// --- report ---------------------------------------------------------------

for (const line of notes) console.log(line)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const line of failures) console.error(line)
  process.exit(1)
}
console.log(`\nall ${notes.length} bundle checks passed`)
