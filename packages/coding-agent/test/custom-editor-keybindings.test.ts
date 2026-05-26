import { describe, expect, it, vi } from "bun:test";
import { defaultEditorTheme } from "../../tui/test/test-themes";
import { CustomEditor } from "../src/modes/components/custom-editor";

function ctrl(key: string): string {
	return String.fromCharCode(key.toLowerCase().charCodeAt(0) & 31);
}

function createEditor() {
	return new CustomEditor(defaultEditorTheme);
}

describe("CustomEditor temporary model selector keybinding", () => {
	it("triggers the temporary selector from a remapped action key instead of Alt+P", () => {
		const editor = createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;
		editor.setActionKeys("app.model.selectTemporary", ["ctrl+y"]);

		editor.handleInput(ctrl("y"));
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});

	it("removes the default Alt+P shortcut when the action is disabled", () => {
		const editor = createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.setActionKeys("app.model.selectTemporary", []);
		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});
});

describe("CustomEditor file picker keybinding", () => {
	it("opens the file picker on the default Alt+Shift+F shortcut", () => {
		const editor = createEditor();
		const onShowFilePicker = vi.fn();
		editor.onShowFilePicker = onShowFilePicker;

		editor.handleInput("\x1bF");
		expect(onShowFilePicker).toHaveBeenCalledTimes(1);
	});

	it("triggers the file picker from a remapped action key instead of Alt+Shift+F", () => {
		const editor = createEditor();
		const onShowFilePicker = vi.fn();
		editor.onShowFilePicker = onShowFilePicker;
		editor.setActionKeys("app.file.picker", ["ctrl+y"]);

		editor.handleInput(ctrl("y"));
		expect(onShowFilePicker).toHaveBeenCalledTimes(1);

		editor.handleInput("\x1bF");
		expect(onShowFilePicker).toHaveBeenCalledTimes(1);
	});
});
