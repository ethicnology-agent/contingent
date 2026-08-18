import { tool } from "@opencode-ai/plugin"
import { deleteSequence, findTerminal, repaint, writeToTerminal } from "../lib/kitty-graphics.ts"

export default tool({
  description:
    "Remove the picture currently shown by image-warp and repaint the interface underneath it. " +
    "Call this when the user asks to close, dismiss or hide the image, or before showing an unrelated one.",
  args: {},
  async execute() {
    const terminal = findTerminal()
    writeToTerminal(terminal.path, deleteSequence())
    repaint(terminal.pid)
    return `Removed the image from ${terminal.path}.`
  },
})
