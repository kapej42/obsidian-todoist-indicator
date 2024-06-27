import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface TodoistIndicatorSettings {
	tdiSetting: string;
	todoistProperty: string;
	projectsFolderPrefix: string;
	projectTag: string;
	RequireProjectTag: boolean;
	projectFileCache: Record<string, any>;
}

const DEFAULT_SETTINGS: Partial<TodoistIndicatorSettings> = {
	todoistProperty: 'todoist',
	projectsFolderPrefix: '1.Projects/',
	projectTag: '#project',
	RequireProjectTag: true,
	tdiSetting: 'default',
	projectFileCache: {}
};

function getFrontMatter(markdownString: string) {
	const frontMatterMatch = markdownString.match(/^---\n([\s\S]*?)\n---/);
	if (frontMatterMatch) {
		const yamlContent = frontMatterMatch[1];
		return parseYaml(yamlContent);
	}
	return null;
}

function parseYaml(yamlContent: string) {
	const lines = yamlContent.split('\n');
	const result = {};
	let currentKey = null;

	lines.forEach(line => {
		if (line.trim() === '') return;

		const keyValueMatch = line.match(/^(\s*)([^:]+):\s*(.*)$/);
		if (keyValueMatch) {
			const indent = keyValueMatch[1].length;
			const key = keyValueMatch[2].trim();
			const value = keyValueMatch[3].trim();

			if (indent === 0) {
				result[key] = parseYamlValue(value);
				currentKey = key;
			} else if (indent > 0 && Array.isArray(result[currentKey])) {
				result[currentKey].push(parseYamlValue(value));
			}
		} else if (currentKey && Array.isArray(result[currentKey])) {
			result[currentKey].push(parseYamlValue(line.trim()));
		}
	});

	return result;
}

function parseYamlValue(value: string) {
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (!isNaN(value)) return parseFloat(value);
	return value;
}

const findTodoistProperty = (string: string, todoistProperty: string) => {
	const frontMatter = getFrontMatter(string);
	return checkTodoistPropertyHasValue(frontMatter, todoistProperty);
};

function checkTodoistPropertyHasValue(frontMatter: any, todoistPropertyName: string) {
	if (frontMatter && frontMatter.hasOwnProperty(todoistPropertyName)) {
		const value = frontMatter[todoistPropertyName];
		if (typeof value === 'string' && value.trim() !== '') {
			return true;
		}
	}
	return false;
}

const clearAllBadges = (fileItem: any) => {
	fileItem.coverEl.removeClass('todoist-indicator');
};

const paintFileBadge = function (this: TodoistIndicatorPlugin, opts: any, fileItem: any) {
	
	
	const slashes = fileItem.file.path.match(/\//g);
	const fileInFolder = slashes ? slashes.length >= 1 : 0;
	
	const folderItem = this.app.workspace.getLeavesOfType('file-explorer')[0].view.fileItems[fileItem.file.parent.path];

	const { TodoistLink } = opts || {};

	if (!TodoistLink) {
		fileItem.coverEl.addClass('todoist-indicator');
		if (fileInFolder) {
			folderItem.coverEl.addClass('todoist-indicator');
		}
	} else {
		clearAllBadges(fileItem);
		if (fileInFolder) {
			clearAllBadges(folderItem);
		}
	}
};

function getFileByPath(filepath: string) {
	const files = this.app.vault.getFiles();
	const fileFound = files.find(file => file.path === filepath);
	if (fileFound) {
		return fileFound;
	} else {
		return "Not a file";
	}
}

function containsTag(file: any, tag: string) {
	const fileCache = this.app.metadataCache.getFileCache(file);
	if (!fileCache) {
		console.error(`File cache not found for file: ${file.path}`);
		return false;
	}

	const metadata = fileCache.tags?.map((a: any) => a.tag);
	let containsTagFile = false;
	if (Array.isArray(metadata)) {
		containsTagFile = metadata.filter((tg: string) => tg.includes(tag)).length > 0;
	}

	const frontMatterTags = fileCache.frontmatter?.tags;
	let containstTagFrontMatter = false;

	const tagWithoutHash = tag.replace('#', '');

	if (Array.isArray(frontMatterTags)) {
		containstTagFrontMatter = frontMatterTags.filter((tg: string) => tg.includes(tagWithoutHash)).length > 0;
	}

	return containstTagFrontMatter || containsTagFile;
}

export default class TodoistIndicatorPlugin extends Plugin {
	settings: TodoistIndicatorSettings;

	async onload() {
		await this.loadSettings();
	
		this.addSettingTab(new SettingTab(this.app, this));

		this.todoistProperty = this.settings.todoistProperty;

		const handleEvent = (event: any, originalFilename: string) => {
		
		//KpMa Todo: add handler for files without tags
			if (!this.isProjectFile(event.path) && (!originalFilename || !this.isProjectFile(originalFilename))) return;
			this.updateFileCacheAndMaybeRepaintBadge(event, originalFilename).catch(error => {
				console.error('Error while handling event!', error);
			});
		};

		this.registerEvent(this.app.vault.on('delete', handleEvent));
		this.registerEvent(this.app.vault.on('rename', handleEvent));
		this.registerEvent(this.app.vault.on('modify', handleEvent));

		this.app.workspace.onLayoutReady(this.initialize.bind(this));
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {
		// Any cleanup can go here
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isProjectFile = (filename: string) => {

		let hasProjectTag = false;
		const file = getFileByPath.call(this, filename);

		if (file != "Not a file") {
			hasProjectTag = containsTag.call(this, file, this.settings.projectTag);
		}

		if (Boolean(this.settings.RequireProjectTag)) {
			return filename.startsWith(this.settings.projectsFolderPrefix)
				&& filename.endsWith('.md')
				&& !filename.includes('/_')
				&& hasProjectTag;
		} else {
			console.log("no")
			return filename.startsWith(this.settings.projectsFolderPrefix)
				&& filename.endsWith('.md')
				&& !filename.includes('/_');
		}
	}

	scheduleRepaintBadge = (path: string, clearAll: boolean) => {
		window.setTimeout(() => {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer');
			if (leaves?.[0]?.view?.fileItems?.[path]) {
				if (clearAll) clearAllBadges(leaves[0].view.fileItems[path]);
				else paintFileBadge.call(this, this.settings.projectFileCache[path], leaves[0].view.fileItems[path]);
			}
		});
	}

	updateFileCacheAndMaybeRepaintBadge = async ({ path, stat, deleted }: any, originalFilename: string) => {
		
		if (deleted || !this.isProjectFile(path)) {
			delete this.settings.projectFileCache[path];
			delete this.settings.projectFileCache[originalFilename];
			await this.saveSettings();
			return this.scheduleRepaintBadge(path, true);
		}
		if (!deleted) {
			const string = await this.app.vault.cachedRead(this.app.vault.getAbstractFileByPath(path));

			const { TodoistLink } = this.settings.projectFileCache[path] || {};
			this.settings.projectFileCache[path] = this.settings.projectFileCache[path] || {};
			this.settings.projectFileCache[path].mtime = stat.mtime;

			this.settings.projectFileCache[path].TodoistLink = findTodoistProperty(string, this.todoistProperty);

			await this.saveSettings();
			if (this.settings.projectFileCache[path].TodoistLink !== TodoistLink) {
				this.scheduleRepaintBadge(path);
			}
		}
	}

	refreshAllFileBadges = async () => {
		const projectFilesList = this.app.vault.getMarkdownFiles().filter(f => this.isProjectFile(f.path));
		const filesMap: Record<string, any> = {};
		let needToSave = false;

		for (const tFile of projectFilesList) {
			filesMap[tFile.path] = this.settings.projectFileCache[tFile.path] || {
				mtime: tFile.stat.mtime,
			};
			const lastCache = this.settings.projectFileCache[tFile.path];
			if (tFile.stat.mtime > (lastCache ? lastCache.mtime : 0)) {
				needToSave = true;
				const string = await this.app.vault.cachedRead(tFile);
				filesMap[tFile.path].TodoistLink = findTodoistProperty(string, this.todoistProperty);
			}
		}

		for (const path in this.settings.projectFileCache) if (!filesMap[path]) needToSave = true;
		if (needToSave) {
			this.settings.projectFileCache = filesMap;
			await this.saveSettings();
		}

		const leaves = this.app.workspace.getLeavesOfType('file-explorer');

		if (leaves?.length) {
			const fileItems = leaves[0].view?.fileItems || {};
			for (const f in fileItems) if (this.isProjectFile(f)) {
				try {
					paintFileBadge.call(this, filesMap[f], fileItems[f]);
				} catch (error) {
					console.error(`Error painting badge for file: ${f}`, error);
				}
			}
		}
	}

	initialize = () => {
		this.refreshAllFileBadges().catch(error => {
			console.error('Unexpected error in "todoist-indicator" plugin initialization.', error);
		});
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	plugin: TodoistIndicatorPlugin;

	constructor(app: App, plugin: TodoistIndicatorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Todoist Indicator plugin Settings' });
		containerEl.createEl('p', { text: 'Please reload Obsidian after changing these settings for them to take effect.' });

		new Setting(containerEl)
			.setName('Projects folder')
			.setDesc('The folder where project files live, e.g. "Projects/".')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectsFolderPrefix)
					.setValue(this.plugin.settings.projectsFolderPrefix)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolderPrefix = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Todoist tag')
			.setDesc('The tag that indicates Todoist link.')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.todoistProperty)
					.setValue(this.plugin.settings.todoistProperty)
					.onChange(async (value) => {
						this.plugin.settings.todoistProperty = value;
						await this.plugin.saveSettings();
					})
			);
		
		new Setting(containerEl)
			.setName('Require Project Tag?')
			.setDesc('With this setting enabled, badges will only appear on files (and their containing folder) with the project tag.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.RequireProjectTag)
				.onChange(async (value) => {
					this.plugin.settings.RequireProjectTag = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Project tag')
			.setDesc('The tag that indicates a file is a project file (handy in case you store project related files in a project folder).')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectTag)
					.setValue(this.plugin.settings.projectTag)
					.onChange(async (value) => {
						this.plugin.settings.projectTag = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
