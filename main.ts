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
	tdiSetting: 'default',
	todoistProperty: 'todoist',
	projectsFolderPrefix: '1.Projects/',
	projectTag: '#project',
	RequireProjectTag: true,
	projectFileCache: {}
};

export default class TodoistIndicatorPlugin extends Plugin {
	settings: TodoistIndicatorSettings;
	todoistProperty: string;
	
	async onload() {
		await this.loadSettings();
		const handleEvent = (event: any, originalFilename: string) => {
			this.refreshFileBadges()
			return
		};

		this.registerEvent(this.app.vault.on('delete', handleEvent));
		this.registerEvent(this.app.vault.on('rename',  handleEvent));
		this.registerEvent(this.app.vault.on('modify', handleEvent));

		this.app.workspace.onLayoutReady(this.initialize.bind(this));
		this.addSettingTab(new SettingTab(this.app, this));
	}
	
	clearAllBadges = (fileItem: any) => {
		fileItem.coverEl.removeClass('todoist-indicator');
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

		hasProjectTag = containsTag(this.app, file, this.settings.projectTag);
		
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

	refreshFileBadges = async () => {
		
		const projectFilesList = this.app.vault.getMarkdownFiles().filter(f => this.isProjectFile(f.path));
		const filesMap: Record<string, any> = {};
		
		let needToSave = false;
		let i =  0
		
		for (const tFile of projectFilesList) {

			// Populate filesMap with the file path and its metadata, either from cache or a new entry
			filesMap[tFile.path] = this.settings.projectFileCache[tFile.path] || {
				mtime: tFile.stat.mtime
			};

			const lastCache = this.settings.projectFileCache[tFile.path];
			if (tFile.stat.mtime > (lastCache ? lastCache.mtime : 0)) {
				needToSave = true;
				const TodoistPropertyValue = this.app.metadataCache.getFileCache(tFile)?.frontmatter[this.settings.todoistProperty];
				filesMap[tFile.path].TodoistPropertyValue = TodoistPropertyValue;				
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
			for (const f in fileItems) {
				if (this.isProjectFile(f)) {
					try {
						this.paintFileBadge(filesMap[f].TodoistPropertyValue, fileItems[f]);
					} catch (error) {
						console.error(`Error painting badge for file: ${f}`, error);
					}
				}
			}
		}
	}

	initialize = () => {		
		this.refreshFileBadges().catch(error => {
			console.error('Unexpected error in "todoist-indicator" plugin initialization.', error);
		});
	}

	paintFileBadge = (todoistValue: any, fileItem: any) => {

		// Count the number of slashes in the file path to determine if the file is in a folder
		const slashes = fileItem.file.path.match(/\//g);
		const fileInFolder = slashes ? slashes.length >= 1 : 0;
		// Get the folder item from the file explorer view
		const folderItem = this.app.workspace.getLeavesOfType('file-explorer')[0].view.fileItems[fileItem.file.parent.path];
	
		if (!todoistValue) {
			// Add a class to indicate the Todoist status on the file item
			fileItem.coverEl.addClass('todoist-indicator');
			// If the file is in a folder, add the class to the folder item as well
			if (fileInFolder) {
				folderItem.coverEl.addClass('todoist-indicator');
			}
		} else {
			// Clear any existing badges on the file item
			this.clearAllBadges(fileItem);
			// If the file is in a folder, clear the badges on the folder item as well
			if (fileInFolder) {
				this.clearAllBadges(folderItem);
			}
		}
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

function containsTag(app: App, file: any, tag: string) {
	if(file){
		const tags = getAllTags(this.app.metadataCache.getFileCache(file));

		if(tags) { 
			return tags.includes(tag);
		} else {
			return false
		}
	} else {
		return false
	}
}