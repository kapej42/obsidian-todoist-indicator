import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, parseYaml, getAllTags } from 'obsidian';

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

function containsTag(file: any, tag: string) {
	if(file){
		const tags = getAllTags(app.metadataCache.getFileCache(file));
		return tags.includes(tag);
	} else {
		return false
	}
}

export default class TodoistIndicatorPlugin extends Plugin {
	settings: TodoistIndicatorSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.todoistProperty = this.settings.todoistProperty;

		const handleEvent = (event: any, originalFilename: string) => {
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

		const file = this.app.vault.getFileByPath(filename);

		if (file != "Not a file") {
			hasProjectTag = containsTag.call(this, file, this.settings.projectTag);
		}

		if (Boolean(this.settings.RequireProjectTag)) {
			return filename.startsWith(this.settings.projectsFolderPrefix)
				&& filename.endsWith('.md')
				&& !filename.includes('/_')
				&& hasProjectTag;
		} else {
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

class SettingTab extends PluginSettingTab {
	plugin: TodoistIndicatorPlugin;

	constructor(app: App, plugin: TodoistIndicatorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
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
			.setName('Require project tag?')
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
