import * as fs from "node:fs";
import * as path from "node:path";
import {
	type Component,
	Container,
	Ellipsis,
	Input,
	matchesKey,
	padding,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import { matchesAppInterrupt } from "../../modes/utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

const MAX_VISIBLE_ENTRIES = 12;
const ENTRY_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface FilePickerEntry {
	name: string;
	absolutePath: string;
	relativePath: string;
	isDirectory: boolean;
}

interface FileEntryListState {
	entries: readonly FilePickerEntry[];
	selectedIndex: number;
	loading: boolean;
	errorMessage: string | null;
	emptyMessage: string;
}

function normalizeRelativePath(rootDir: string, targetPath: string): string {
	const relativePath = path.relative(rootDir, targetPath);
	return relativePath.split(path.sep).join("/");
}

function directoryLabel(rootDir: string, currentDir: string): string {
	const relativePath = normalizeRelativePath(rootDir, currentDir);
	return relativePath.length > 0 ? relativePath : ".";
}

class FileEntryList implements Component {
	#state: FileEntryListState = {
		entries: [],
		selectedIndex: 0,
		loading: true,
		errorMessage: null,
		emptyMessage: "No files in this directory",
	};

	setState(state: FileEntryListState): void {
		this.#state = state;
	}

	invalidate(): void {
		// Stateless renderer.
	}

	render(width: number): string[] {
		if (this.#state.loading) {
			return [theme.fg("muted", "  Loading files…")];
		}

		if (this.#state.errorMessage) {
			return [theme.fg("error", `  ${this.#state.errorMessage}`)];
		}

		if (this.#state.entries.length === 0) {
			return [theme.fg("muted", `  ${this.#state.emptyMessage}`)];
		}

		const lines: string[] = [];
		const startIndex = Math.max(
			0,
			Math.min(
				this.#state.selectedIndex - Math.floor(MAX_VISIBLE_ENTRIES / 2),
				this.#state.entries.length - MAX_VISIBLE_ENTRIES,
			),
		);
		const endIndex = Math.min(startIndex + MAX_VISIBLE_ENTRIES, this.#state.entries.length);

		for (let i = startIndex; i < endIndex; i++) {
			const entry = this.#state.entries[i];
			if (!entry) continue;
			const isSelected = i === this.#state.selectedIndex;
			const cursorSymbol = `${theme.nav.cursor} `;
			const cursorWidth = visibleWidth(cursorSymbol);
			const cursor = isSelected ? theme.fg("accent", cursorSymbol) : padding(cursorWidth);
			const suffix = entry.isDirectory ? "/" : "";
			const maxWidth = Math.max(1, width - cursorWidth);
			const label = truncateToWidth(`${entry.name}${suffix}`, maxWidth, Ellipsis.Omit);
			const line = `${cursor}${label}`;
			lines.push(isSelected ? theme.bold(line) : line);
		}

		if (startIndex > 0 || endIndex < this.#state.entries.length) {
			lines.push(theme.fg("muted", `  (${this.#state.selectedIndex + 1}/${this.#state.entries.length})`));
		}

		return lines;
	}
}

export class FilePickerComponent extends Container {
	readonly #rootDir: string;
	#currentDir: string;
	readonly #filterInput: Input;
	readonly #pathText: Text;
	readonly #entryList: FileEntryList;
	readonly #requestRender: () => void;
	readonly #onSelect: (absolutePath: string) => void;
	readonly #onCancel: () => void;
	#entries: FilePickerEntry[] = [];
	#filteredEntries: FilePickerEntry[] = [];
	#selectedIndex = 0;
	#loading = true;
	#errorMessage: string | null = null;
	#loadRequestId = 0;

	constructor(
		rootDir: string,
		onSelect: (absolutePath: string) => void,
		onCancel: () => void,
		requestRender: () => void,
	) {
		super();
		this.#rootDir = path.resolve(rootDir);
		this.#currentDir = this.#rootDir;
		this.#onSelect = onSelect;
		this.#onCancel = onCancel;
		this.#requestRender = requestRender;
		this.#filterInput = new Input();
		this.#pathText = new Text("", 1, 0);
		this.#entryList = new FileEntryList();

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Insert Path"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#pathText);
		this.addChild(new Text(theme.fg("muted", "Filter"), 1, 0));
		this.addChild(this.#filterInput);
		this.addChild(new Spacer(1));
		this.addChild(this.#entryList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					"up/down navigate  enter open file/select file  tab insert directory  ←/backspace parent  esc cancel",
				),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.#updatePathText();
		this.#syncEntryList();
		void this.#loadDirectory(this.#rootDir);
	}

	handleInput(keyData: string): void {
		if (matchesAppInterrupt(keyData)) {
			if (this.#filterInput.getValue().length > 0) {
				this.#filterInput.setValue("");
				this.#applyFilter();
				this.#requestRender();
				return;
			}
			this.#onCancel();
			return;
		}

		if (matchesKey(keyData, "up")) {
			this.#moveSelection(-1);
			return;
		}

		if (matchesKey(keyData, "down")) {
			this.#moveSelection(1);
			return;
		}

		if (matchesKey(keyData, "pageUp")) {
			this.#moveSelection(-MAX_VISIBLE_ENTRIES);
			return;
		}

		if (matchesKey(keyData, "pageDown")) {
			this.#moveSelection(MAX_VISIBLE_ENTRIES);
			return;
		}

		if (matchesKey(keyData, "left") || matchesKey(keyData, "backspace")) {
			if (this.#filterInput.getValue().length > 0) {
				const before = this.#filterInput.getValue();
				this.#filterInput.handleInput(keyData);
				if (this.#filterInput.getValue() !== before) {
					this.#applyFilter();
					this.#requestRender();
				}
				return;
			}

			if (this.#currentDir !== this.#rootDir) {
				void this.#loadDirectory(path.dirname(this.#currentDir));
			}
			return;
		}

		if (matchesKey(keyData, "right")) {
			const selectedEntry = this.#getSelectedEntry();
			if (selectedEntry?.isDirectory) {
				void this.#loadDirectory(selectedEntry.absolutePath);
			}
			return;
		}

		if (matchesKey(keyData, "tab")) {
			this.#insertSelectedDirectory();
			return;
		}

		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			void this.#activateSelectedEntry();
			return;
		}

		const before = this.#filterInput.getValue();
		this.#filterInput.handleInput(keyData);
		if (this.#filterInput.getValue() !== before) {
			this.#applyFilter();
			this.#requestRender();
		}
	}

	async #activateSelectedEntry(): Promise<void> {
		const selectedEntry = this.#getSelectedEntry();
		if (!selectedEntry) return;
		if (selectedEntry.isDirectory) {
			await this.#loadDirectory(selectedEntry.absolutePath);
			return;
		}
		this.#onSelect(selectedEntry.absolutePath);
	}

	#insertSelectedDirectory(): void {
		const selectedEntry = this.#getSelectedEntry();
		if (!selectedEntry?.isDirectory) return;
		this.#onSelect(selectedEntry.absolutePath);
	}

	#getSelectedEntry(): FilePickerEntry | undefined {
		return this.#filteredEntries[this.#selectedIndex];
	}

	#moveSelection(delta: number): void {
		if (this.#filteredEntries.length === 0) return;
		this.#selectedIndex = Math.max(0, Math.min(this.#filteredEntries.length - 1, this.#selectedIndex + delta));
		this.#syncEntryList();
		this.#requestRender();
	}

	async #loadDirectory(nextDir: string): Promise<void> {
		const requestId = ++this.#loadRequestId;
		this.#loading = true;
		this.#errorMessage = null;
		this.#syncEntryList();
		this.#requestRender();

		try {
			const dirents = await fs.promises.readdir(nextDir, { withFileTypes: true });
			const entries = (await Promise.all(dirents.map(dirent => this.#toEntry(nextDir, dirent)))).filter(
				(entry): entry is FilePickerEntry => entry !== null,
			);
			entries.sort((left, right) => {
				if (left.isDirectory !== right.isDirectory) {
					return left.isDirectory ? -1 : 1;
				}
				return ENTRY_NAME_COLLATOR.compare(left.name, right.name);
			});

			if (requestId !== this.#loadRequestId) return;
			this.#currentDir = nextDir;
			this.#entries = entries;
			this.#filterInput.setValue("");
			this.#selectedIndex = 0;
			this.#loading = false;
			this.#errorMessage = null;
			this.#applyFilter();
			this.#requestRender();
		} catch {
			if (requestId !== this.#loadRequestId) return;
			this.#currentDir = nextDir;
			this.#entries = [];
			this.#filteredEntries = [];
			this.#selectedIndex = 0;
			this.#loading = false;
			this.#errorMessage = "Unable to read this directory.";
			this.#updatePathText();
			this.#syncEntryList();
			this.#requestRender();
		}
	}

	async #toEntry(parentDir: string, dirent: fs.Dirent): Promise<FilePickerEntry | null> {
		if (dirent.name === ".git") return null;
		const absolutePath = path.join(parentDir, dirent.name);
		let isDirectory = dirent.isDirectory();
		let isFile = dirent.isFile();
		if (!isDirectory && !isFile && dirent.isSymbolicLink()) {
			try {
				const stat = await fs.promises.stat(absolutePath);
				isDirectory = stat.isDirectory();
				isFile = stat.isFile();
			} catch {
				return null;
			}
		}
		if (!isDirectory && !isFile) return null;
		return {
			name: dirent.name,
			absolutePath,
			relativePath: normalizeRelativePath(this.#rootDir, absolutePath),
			isDirectory,
		};
	}

	#applyFilter(): void {
		const query = this.#filterInput.getValue().trim().toLowerCase();
		this.#filteredEntries =
			query.length === 0
				? [...this.#entries]
				: this.#entries.filter(entry => {
						const entryName = entry.name.toLowerCase();
						const relativePath = entry.relativePath.toLowerCase();
						return entryName.includes(query) || relativePath.includes(query);
					});
		this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, this.#filteredEntries.length - 1));
		this.#updatePathText();
		this.#syncEntryList();
	}

	#updatePathText(): void {
		const currentLabel = directoryLabel(this.#rootDir, this.#currentDir);
		const totalCount = this.#entries.length;
		const noun = totalCount === 1 ? "entry" : "entries";
		this.#pathText.setText(theme.fg("muted", `Directory: ${currentLabel} • ${totalCount} ${noun}`));
	}

	#syncEntryList(): void {
		this.#updatePathText();
		const query = this.#filterInput.getValue().trim();
		this.#entryList.setState({
			entries: this.#filteredEntries,
			selectedIndex: this.#selectedIndex,
			loading: this.#loading,
			errorMessage: this.#errorMessage,
			emptyMessage: query.length > 0 ? "No matching files" : "No files in this directory",
		});
	}
}
