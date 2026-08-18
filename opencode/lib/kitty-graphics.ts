// Kitty graphics protocol helpers, shared by the image-warp tools.
//
// Warp implements the Kitty graphics protocol but not the iTerm2 inline-image
// protocol, despite advertising neither. Probing the terminal directly is what
// settled it:
//
//   DA1 (ESC [ c)                -> ESC [ ?62c        (VT220 only, no Sixel)
//   iTerm2 ReportCellSize        -> no response       (OSC 1337 unimplemented)
//   Kitty query (ESC _G a=q ...) -> ESC _Gi=31;OK     (protocol understood)
//
// Kitty images are placements on a layer above the text grid, so they survive
// the TUI repainting underneath them and must be deleted explicitly by id.

import { spawnSync } from "node:child_process"
import { closeSync, openSync, writeSync } from "node:fs"
import path from "node:path"

/** Single placement slot: displaying an image replaces the previous one. */
export const IMAGE_ID = 7
/** Terminal cells are roughly twice as tall as they are wide. TIOCGWINSZ
 *  reports no pixel size across SSH, so this ratio cannot be measured. */
const CELL_ASPECT = 0.5
const CHUNK = 4096

export type Terminal = { path: string; pid: number }
export type Size = { cols: number; rows: number }

export function isWithin(base: string, target: string) {
  const relative = path.relative(base, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/**
 * Locate the terminal to draw on, plus the pid attached to it.
 *
 * Tool shells run without a controlling terminal, so opening /dev/tty fails
 * with ENXIO; the tty belongs to an ancestor process (the opencode TUI). The
 * pid is needed to send SIGWINCH, which makes the TUI repaint the text an
 * image was covering.
 */
export function findTerminal(): Terminal {
  let pid = process.pid
  while (pid > 1) {
    const parent = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)]).stdout.toString().trim()
    const ppid = Number(parent) || 0
    if (ppid === 0) break
    const tty = spawnSync("ps", ["-o", "tty=", "-p", String(ppid)]).stdout.toString().trim()
    if (tty && tty !== "?" && tty !== "??") {
      return { path: tty.startsWith("/dev/") ? tty : `/dev/${tty}`, pid: ppid }
    }
    pid = ppid
  }
  throw new Error("No ancestor process owns a terminal: nothing to draw on.")
}

export function terminalSize(ttyPath: string): Size {
  const out = spawnSync("stty", ["size", "-F", ttyPath]).stdout.toString().trim().split(/\s+/)
  const rows = Number(out[0])
  const cols = Number(out[1])
  // A pty with no window size reports "0 0"; terminfo's 80x24 beats a
  // negative image box.
  if (!cols || !rows || Number.isNaN(cols) || Number.isNaN(rows)) return { cols: 80, rows: 24 }
  return { cols, rows }
}

export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

export function fitCells(img: { w: number; h: number } | null, max: Size): Size {
  if (!img || img.h === 0) return max
  const aspectCells = img.w / img.h / CELL_ASPECT
  if (aspectCells >= max.cols / max.rows) {
    return { cols: max.cols, rows: Math.max(1, Math.round(max.cols / aspectCells)) }
  }
  return { cols: Math.max(1, Math.round(max.rows * aspectCells)), rows: max.rows }
}

/** Build the escape sequence that draws a PNG at a cell rectangle. */
export function drawSequence(png: Buffer, box: Size, offset: { col: number; row: number }): string {
  const payload = png.toString("base64")
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += CHUNK) chunks.push(payload.slice(i, i + CHUNK))

  // Save the cursor, jump to the image corner, transmit, put the cursor back.
  let sequence = `\x1b[s\x1b[${offset.row + 1};${offset.col + 1}H`
  chunks.forEach((chunk, index) => {
    const more = index === chunks.length - 1 ? 0 : 1
    sequence += index === 0
      // f=100 is PNG; c= and r= give the exact cell rectangle to fill; q=2
      // suppresses the terminal's acknowledgement, which would otherwise be
      // read as keyboard input.
      ? `\x1b_Ga=T,f=100,q=2,i=${IMAGE_ID},c=${box.cols},r=${box.rows},m=${more};${chunk}\x1b\\`
      : `\x1b_Gm=${more};${chunk}\x1b\\`
  })
  return sequence + "\x1b[u"
}

/** Delete the placement and free the stored image data. */
export function deleteSequence(): string {
  return `\x1b_Ga=d,d=I,i=${IMAGE_ID}\x1b\\`
}

export function writeToTerminal(ttyPath: string, sequence: string) {
  const buf = Buffer.from(sequence, "utf8")
  const fd = openSync(ttyPath, "w")
  try {
    let offset = 0
    while (offset < buf.length) offset += writeSync(fd, buf, offset, buf.length - offset)
  } finally {
    closeSync(fd)
  }
}

/** Ask the process on the tty to repaint, revealing what the image covered. */
export function repaint(pid: number) {
  try {
    process.kill(pid, "SIGWINCH")
  } catch {
    // The TUI exited; nothing to repaint.
  }
}
