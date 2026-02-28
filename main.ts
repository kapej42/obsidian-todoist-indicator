import { App, Plugin, PluginSettingTab, Setting, getAllTags, TFile } from 'obsidian';

interface TodoistIndicatorSettings {
	tdiSetting: string;
	todoistProperty: string;
	projectsFolderPrefix: string;
	projectTag: string;
	RequireProjectTag: boolean;
	projectFileCache: Record<string, any>;
}

const DEFAULT_SETTINGS: TodoistIndicatorSettings = {
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

		this.registerEvent(this.app.vault.on('delete', this.refreshFileBadge));
		this.registerEvent(this.app.vault.on('rename', this.refreshFileBadge));
		this.registerEvent(this.app.vault.on('modify', this.refreshFileBadge));

		this.app.workspace.onLayoutReady(this.initialize.bind(this));
		this.addSettingTab(new SettingTab(this.app, this));
	}

	getViewFileItems() {
		// Load file ites in file explorer view
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		const view: any = leaves[0].view;
		return leaves?.length ? view?.fileItems : {}
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

	isProjectFile = (file: TFile) => {
		const hasProjectTag = this.containsTag(file, this.settings.projectTag);

		if (Boolean(this.settings.RequireProjectTag)) {
			return file.path.startsWith(this.settings.projectsFolderPrefix)
				&& file.path.endsWith('.md')
				&& hasProjectTag;

		} else {
			return file.path.startsWith(this.settings.projectsFolderPrefix)
				&& file.path.endsWith('.md');
		}
	}

	refreshFileBadge = async (file: TFile) => {
		const fileItems = this.getViewFileItems()
		const fileItem = fileItems[file.path];

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				this.paintFileBadge(frontmatter[this.settings.todoistProperty], fileItem);
			});
		} catch (e) {
			this.error('Error processing fronmatter', e)
		}
	}

	initialize = () => {
		const projectFiles = this.app.vault.getFiles().filter(f => this.isProjectFile(f));

		Promise
			.all(projectFiles
				.map(f => this.refreshFileBadge(f)))
			.catch(e => this.error("error initializing all files", e));
	}

	paintFileBadge = (todoistValue: any, fileItem: any) => {

		// Count the number of slashes in the file path to determine if the file is in a folder
		const slashes = fileItem.file.path.match(/\//g);
		const fileInFolder = slashes ? slashes.length >= 1 : 0;

		// deterime if the indicator should be shown or not
		const shouldShowIndicator = !Boolean(todoistValue) && this.isProjectFile(fileItem.file);
		
		// class would be applied or not depending on the flag calculated
		fileItem.coverEl.toggleClass('todoist-indicator', shouldShowIndicator);
		if (fileInFolder) {
			fileItem.parent?.coverEl.toggleClass('todoist-indicator', shouldShowIndicator);
		}
	}

	containsTag(file: TFile, tag: string) {

		if (!file) return false;

		const cachedFile = this.app.metadataCache.getFileCache(file);
		const tags = cachedFile ? getAllTags(cachedFile) : [];

		return tags?.some(t => t.startsWith(tag))
	}

	log(...args: any) {
		console.log(`${this.manifest.id}:`, ...args)
	}
	error(...args: any) {
		console.error(`${this.manifest.id}:`, ...args)
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
