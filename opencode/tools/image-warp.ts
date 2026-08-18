import { tool } from "@opencode-ai/plugin"
import { lstat, readFile, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  drawSequence,
  findTerminal,
  fitCells,
  isWithin,
  pngSize,
  terminalSize,
  writeToTerminal,
} from "../lib/kitty-graphics.ts"

const GENERATED_IMAGES = path.join(os.homedir(), "debian/generated-images")
// Leave room for the interface around the image.
const CHROME_COLS = 4
const CHROME_ROWS = 8

export default tool({
  description:
    "Show a local PNG to the user as a real picture, centered in their terminal, using the Kitty graphics protocol. " +
    "Prefer this over image-display, whose Chafa output is coarse ASCII art. " +
    "Use it whenever the user should actually see something: a screenshot, a diagram, a generated image. " +
    "The picture stays on screen, above the interface, until image-warp-close removes it. " +
    "PNG only, inside the current worktree or ~/debian/generated-images.",
  args: {
    imagePath: tool.schema.string().min(1).describe("Absolute path, or a path relative to the current directory."),
    maxWidth: tool.schema.number().int().min(8).max(500).optional()
      .describe("Maximum width in terminal cells. Defaults to the terminal width."),
    maxHeight: tool.schema.number().int().min(4).max(200).optional()
      .describe("Maximum height in terminal cells. Defaults to the terminal height."),
  },
  async execute(args, context) {
    if (context.abort.aborted) throw new Error("Image display was cancelled before it started.")

    const requested = path.resolve(context.directory, args.imagePath)
    const imagePath = await realpath(requested).catch(() => {
      throw new Error(`Image does not exist or cannot be resolved: ${requested}`)
    })
    const info = await lstat(imagePath)
    if (!info.isFile()) throw new Error(`Image is not a regular file: ${imagePath}`)

    const worktree = await realpath(context.worktree)
    const filesystemRoot = path.parse(worktree).root
    const projectRoot = worktree === filesystemRoot ? await realpath(context.directory) : worktree
    const generatedImages = await realpath(GENERATED_IMAGES).catch(() => GENERATED_IMAGES)
    if (!isWithin(projectRoot, imagePath) && !isWithin(generatedImages, imagePath)) {
      throw new Error(`Image must be inside ${projectRoot} or ${GENERATED_IMAGES}: ${args.imagePath}`)
    }

    const png = await readFile(imagePath)
    const size = pngSize(png)
    if (!size) {
      // The protocol only transmits PNG directly, and this machine has no
      // image converter installed.
      throw new Error(`Not a PNG file: ${imagePath}. Convert it to PNG first.`)
    }

    const terminal = findTerminal()
    const term = terminalSize(terminal.path)
    const box = fitCells(size, {
      cols: Math.min(args.maxWidth ?? term.cols - CHROME_COLS, term.cols - 1),
      rows: Math.min(args.maxHeight ?? term.rows - CHROME_ROWS, term.rows - 1),
    })
    const offset = {
      col: Math.max(0, Math.floor((term.cols - box.cols) / 2)),
      row: Math.max(0, Math.min(Math.floor((term.rows - box.rows) / 2), term.rows - box.rows - 1)),
    }

    writeToTerminal(terminal.path, drawSequence(png, box, offset))

    return `Showed ${imagePath} (${size.w}x${size.h} px) centered on ${terminal.path} ` +
      `as ${box.cols}x${box.rows} cells. Call image-warp-close to remove it.`
  },
})
