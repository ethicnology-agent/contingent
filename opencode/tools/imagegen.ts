import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const CODEX = path.join(
  os.homedir(),
  "debian/codex-cli/node_modules/.bin/codex",
)
const OUTPUT_ROOT = path.join(os.homedir(), "debian/generated-images")
const MAX_PROMPT_LENGTH = 8_000
const TIMEOUT_MS = 10 * 60 * 1_000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isWithin(base: string, target: string) {
  const relative = path.relative(base, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export default tool({
  description:
    "Generate an original image with GPT-Image-2 using the authenticated ChatGPT Codex account. Outputs only to ~/debian/generated-images. Use for illustrations, mascots, UI assets, character sheets, and targeted image edits.",
  args: {
    prompt: tool.schema
      .string()
      .min(1)
      .max(MAX_PROMPT_LENGTH)
      .describe("Concrete image-generation or image-editing instructions."),
    filename: tool.schema
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,79}\.png$/)
      .describe("New lowercase PNG filename, for example bull-concepts-v1.png."),
    referenceImages: tool.schema
      .array(tool.schema.string())
      .max(8)
      .optional()
      .describe(
        "Optional image paths. Relative paths resolve from the current directory. Only images in the worktree or ~/debian/generated-images are accepted.",
      ),
  },
  async execute(args, context) {
    await access(CODEX, constants.X_OK).catch(() => {
      throw new Error(`Codex CLI is missing or not executable: ${CODEX}`)
    })
    if (context.abort.aborted) throw new Error("Image generation was cancelled before it started.")

    await mkdir(OUTPUT_ROOT, { recursive: true })
    const canonicalOutputRoot = await realpath(OUTPUT_ROOT)
    const canonicalWorktree = await realpath(context.worktree)
    const filesystemRoot = path.parse(canonicalWorktree).root
    const canonicalProjectRoot = canonicalWorktree === filesystemRoot
      ? await realpath(context.directory)
      : canonicalWorktree

    const outputPath = path.join(OUTPUT_ROOT, args.filename)
    const lockPath = `${outputPath}.lock`
    let lock: Awaited<ReturnType<typeof open>>
    try {
      lock = await open(lockPath, "wx")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Image generation is already using this filename: ${outputPath}`)
      }
      throw error
    }

    let outputMayBeNew = false
    try {
      try {
        await lstat(outputPath)
        throw new Error(`Refusing to overwrite existing image: ${outputPath}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        outputMayBeNew = true
      }

      const references: string[] = []
      for (const rawReference of args.referenceImages ?? []) {
        const reference = path.resolve(context.directory, rawReference)
        const canonicalReference = await realpath(reference).catch(() => {
          throw new Error(`Reference image does not exist or cannot be resolved: ${reference}`)
        })
        if (!(await lstat(canonicalReference)).isFile()) {
          throw new Error(`Reference image is not a regular file: ${reference}`)
        }
        if (
          !isWithin(canonicalProjectRoot, canonicalReference) &&
          !isWithin(canonicalOutputRoot, canonicalReference)
        ) {
          throw new Error(
            `Reference must be inside ${canonicalProjectRoot} or ${OUTPUT_ROOT}: ${rawReference}`,
          )
        }
        references.push(canonicalReference)
      }

      const fullPrompt = [
        "$imagegen",
        args.prompt.trim(),
        "Create original artwork. Treat attached first-party brand assets as authorized references supplied by the user, but do not imitate third-party mascots, artists, or stock assets.",
        `Save exactly one final PNG image as ${outputPath}.`,
        "Do not create or modify any other file.",
      ].join("\n\n")

      const command = [
        CODEX,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--model",
        "gpt-5.6-terra",
        "--color",
        "never",
      ]
      for (const reference of references) command.push("--image", reference)

      const child = spawn(command[0], command.slice(1), {
        cwd: OUTPUT_ROOT,
        detached: true,
        env: {
          HOME: os.homedir(),
          LANG: process.env.LANG ?? "C.UTF-8",
          PATH: `${path.join(OUTPUT_ROOT, ".venv/bin")}:${process.env.PATH ?? ""}`,
          TERM: "dumb",
        },
        stdio: ["pipe", "pipe", "pipe"],
      })
      child.stdin.end(fullPrompt)
      let stdout = ""
      let stderr = ""
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        stdout = (stdout + chunk).slice(-8_000)
      })
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8_000)
      })

      const terminate = () => {
        if (!child.pid) return
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            try {
              child.kill("SIGKILL")
            } catch {
              // The process exited between the group and direct kill attempts.
            }
          }
        }
      }

      let timeout: NodeJS.Timeout | undefined
      let rejectAbort: (reason: Error) => void = () => {}
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = reject
      })
      const onAbort = () => {
        terminate()
        rejectAbort(new Error("Image generation was cancelled."))
      }
      context.abort.addEventListener("abort", onAbort, { once: true })
      if (context.abort.aborted) onAbort()
      try {
        const exitCode = await Promise.race([
          new Promise<number>((resolve, reject) => {
            child.once("error", reject)
            child.once("close", (code) => resolve(code ?? 1))
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              terminate()
              reject(new Error("Image generation timed out after 10 minutes."))
            }, TIMEOUT_MS)
          }),
          aborted,
        ])

        if (exitCode !== 0) {
          throw new Error(
            `Codex image generation failed (${exitCode}).\n${stderr.slice(-4_000)}\n${stdout.slice(-2_000)}`,
          )
        }
      } finally {
        if (timeout) clearTimeout(timeout)
        context.abort.removeEventListener("abort", onAbort)
      }

      let outputInfo: Awaited<ReturnType<typeof lstat>>
      try {
        outputInfo = await lstat(outputPath)
      } catch {
        const files = await readdir(OUTPUT_ROOT)
        throw new Error(
          `Codex completed but did not create ${outputPath}. Files present: ${files.join(", ")}\n${stdout.slice(-2_000)}\n${stderr.slice(-2_000)}`,
        )
      }
      if (!outputInfo.isFile()) throw new Error(`Generated output is not a regular file: ${outputPath}`)

      const output = await open(outputPath, "r")
      try {
        const signature = Buffer.alloc(PNG_SIGNATURE.length)
        const { bytesRead } = await output.read(signature, 0, signature.length, 0)
        if (bytesRead !== signature.length || !signature.equals(PNG_SIGNATURE)) {
          throw new Error(`Generated output is not a valid PNG file: ${outputPath}`)
        }
      } finally {
        await output.close()
      }

      return [
        `Generated: ${outputPath}`,
        `References: ${references.length}`,
        stdout.slice(-2_000).trim(),
      ]
        .filter(Boolean)
        .join("\n")
    } catch (error) {
      if (outputMayBeNew) await rm(outputPath, { force: true })
      throw error
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  },
})
