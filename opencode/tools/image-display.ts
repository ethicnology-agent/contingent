import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, lstat, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const CHAFA = "/usr/bin/chafa"
const GENERATED_IMAGES = path.join(os.homedir(), "debian/generated-images")
const MAX_DIMENSION = 120
const TIMEOUT_MS = 30_000

function isWithin(base: string, target: string) {
  const relative = path.relative(base, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export default tool({
  description:
    "Display a local image inline in the user's terminal with Chafa. Use after generating an image or when the user asks to preview one. Images must be inside the current worktree or ~/debian/generated-images.",
  args: {
    imagePath: tool.schema.string().min(1).describe("Absolute path, or a path relative to the current directory."),
    mode: tool.schema
      .enum(["auto", "symbols"])
      .default("auto")
      .describe("auto uses the best terminal graphics protocol; symbols forces portable ANSI/Unicode output."),
    width: tool.schema.number().int().min(8).max(MAX_DIMENSION).default(80),
    height: tool.schema.number().int().min(4).max(MAX_DIMENSION).default(40),
  },
  async execute(args, context) {
    await access(CHAFA, constants.X_OK).catch(() => {
      throw new Error(`Chafa is missing or not executable: ${CHAFA}`)
    })
    if (context.abort.aborted) throw new Error("Image display was cancelled before it started.")

    const requested = path.resolve(context.directory, args.imagePath)
    const imagePath = await realpath(requested).catch(() => {
      throw new Error(`Image does not exist or cannot be resolved: ${requested}`)
    })
    const info = await lstat(imagePath)
    if (!info.isFile()) throw new Error(`Image is not a regular file: ${imagePath}`)

    const worktree = await realpath(context.worktree)
    const filesystemRoot = path.parse(worktree).root
    const projectRoot = worktree === filesystemRoot
      ? await realpath(context.directory)
      : worktree
    const generatedImages = await realpath(GENERATED_IMAGES).catch(() => GENERATED_IMAGES)
    if (!isWithin(projectRoot, imagePath) && !isWithin(generatedImages, imagePath)) {
      throw new Error(
        `Image must be inside ${projectRoot} or ${GENERATED_IMAGES}: ${args.imagePath}`,
      )
    }

    const command = [
      ...(args.mode === "symbols" ? ["--format", "symbols"] : []),
      "--size",
      `${args.width}x${args.height}`,
      "--duration",
      "0",
      imagePath,
    ]
    const child = spawn(CHAFA, command, {
      stdio: ["ignore", "inherit", "pipe"],
      env: process.env,
    })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000)
    })

    const terminate = () => child.kill("SIGKILL")
    const onAbort = () => terminate()
    context.abort.addEventListener("abort", onAbort, { once: true })
    let timeout: NodeJS.Timeout | undefined
    try {
      const exitCode = await Promise.race([
        new Promise<number>((resolve, reject) => {
          child.once("error", reject)
          child.once("close", (code) => resolve(code ?? 1))
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            terminate()
            reject(new Error("Chafa timed out after 30 seconds."))
          }, TIMEOUT_MS)
        }),
      ])
      if (context.abort.aborted) throw new Error("Image display was cancelled.")
      if (exitCode !== 0) {
        throw new Error(`Chafa failed (${exitCode}): ${stderr.trim()}`)
      }
      return `Displayed ${imagePath} with Chafa (${args.mode}, ${args.width}x${args.height}).`
    } finally {
      if (timeout) clearTimeout(timeout)
      context.abort.removeEventListener("abort", onAbort)
    }
  },
})
