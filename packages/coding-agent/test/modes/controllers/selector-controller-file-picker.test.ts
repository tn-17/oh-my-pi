import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { FilePickerComponent } from "../../../src/modes/components/file-picker";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { initTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

type TestContext = InteractiveModeContext & {
	editorContainer: {
		children: unknown[];
		clear: () => void;
		addChild: (child: unknown) => void;
	};
	editor: {
		insertText: (text: string) => void;
	};
};

function createContext(cwd: string) {
	const editorContainer = {
		children: [] as unknown[],
		clear() {
			this.children = [];
		},
		addChild(child: unknown) {
			this.children.push(child);
		},
	};
	const insertText = vi.fn();
	const requestRender = vi.fn();
	const setFocus = vi.fn();
	const editor = { insertText };
	const ctx = {
		editorContainer,
		editor,
		ui: {
			requestRender,
			setFocus,
			terminal: { rows: 40, columns: 120 },
		},
		sessionManager: {
			getCwd: () => cwd,
		},
	} as unknown as TestContext;
	return {
		ctx,
		spies: { insertText, requestRender, setFocus },
	};
}

async function waitForPickerIdle(picker: FilePickerComponent): Promise<void> {
	for (let attempts = 0; attempts < 20; attempts++) {
		if (!picker.render(120).join("\n").includes("Loading files")) {
			return;
		}
		await Bun.sleep(0);
	}
	throw new Error("File picker did not finish loading");
}

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SelectorController file picker", () => {
	it("navigates directories and inserts the selected relative path in backticks", async () => {
		using tempDir = TempDir.createSync("@omp-file-picker-");
		const cwd = tempDir.path();
		await fs.mkdir(path.join(cwd, "src"), { recursive: true });
		await Bun.write(path.join(cwd, "README.md"), "readme\n");
		await Bun.write(path.join(cwd, "src", "app.ts"), "export const ok = true;\n");
		const { ctx, spies } = createContext(cwd);
		const controller = new SelectorController(ctx);

		controller.showFilePicker();
		const picker = ctx.editorContainer.children[0];
		if (!(picker instanceof FilePickerComponent)) {
			throw new Error("Expected file picker component");
		}

		await waitForPickerIdle(picker);
		picker.handleInput("\n");
		await waitForPickerIdle(picker);
		picker.handleInput("\n");

		expect(spies.insertText).toHaveBeenCalledWith("`src/app.ts`");
		expect(ctx.editorContainer.children[0]).toBe(ctx.editor);
		expect(spies.setFocus).toHaveBeenLastCalledWith(ctx.editor);
	});

	it("inserts the selected directory path in backticks on tab without opening it", async () => {
		using tempDir = TempDir.createSync("@omp-file-picker-");
		const cwd = tempDir.path();
		await fs.mkdir(path.join(cwd, "src"), { recursive: true });
		await Bun.write(path.join(cwd, "src", "app.ts"), "export const ok = true;\n");
		const { ctx, spies } = createContext(cwd);
		const controller = new SelectorController(ctx);

		controller.showFilePicker();
		const picker = ctx.editorContainer.children[0];
		if (!(picker instanceof FilePickerComponent)) {
			throw new Error("Expected file picker component");
		}

		await waitForPickerIdle(picker);
		picker.handleInput("\t");

		expect(spies.insertText).toHaveBeenCalledWith("`src`");
		expect(ctx.editorContainer.children[0]).toBe(ctx.editor);
		expect(spies.setFocus).toHaveBeenLastCalledWith(ctx.editor);
	});
});
