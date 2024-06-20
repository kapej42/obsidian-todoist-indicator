const { Plugin, PluginSettingTab, Setting } = require('obsidian')

const DEFAULT_SETTINGS = {
	todoistProperty: 'todoist',
	projectsFolderPrefix: '1.Projects/',
	projectTag: '#project',
	RequireProjectTag: true
}

function* stringLineIterator(string) {
	let cursor = 0
	let newlineIndex = string.indexOf('\n')
	while (newlineIndex !== -1) {
		yield string.substring(cursor, newlineIndex)
		cursor = newlineIndex + 1
		newlineIndex = string.indexOf('\n', cursor)
	}
	if (cursor < string.length) yield string.substring(cursor)
}

const CODE_FENCE_CHARS = /^`{3,}/
function* stringLineIteratorNoCode(string) {
	let codeFenceDepth = 0
	for (let line of stringLineIterator(string)) {
		let codeFenceCharCount = line.startsWith('```') && CODE_FENCE_CHARS.exec(line)[0].length
		if (codeFenceDepth && codeFenceDepth === codeFenceCharCount) {
			codeFenceDepth = 0
		} else if (!codeFenceDepth && codeFenceCharCount) {
			codeFenceDepth = codeFenceCharCount
		} else if (!codeFenceDepth) {
			yield line
		}
	}
}

// Function to extract YAML front matter from a string
function getFrontMatter(markdownString) {
    const frontMatterMatch = markdownString.match(/^---\n([\s\S]*?)\n---/);
    if (frontMatterMatch) {
        const yamlContent = frontMatterMatch[1];
        return parseYaml(yamlContent);
    }
    return null;
}

// Basic YAML parser
function parseYaml(yamlContent) {
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

// Function to parse individual YAML values
function parseYamlValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value)) return parseFloat(value);
    return value;
}

const findTodoistProperty = ( string, todoistProperty ) => {

	console.log("entering findTodoistProperty")

	let hasTodoistProperty = false

    const frontMatter = getFrontMatter(string);
	const hasValue = checkTodoistPropertyHasValue(frontMatter, todoistProperty);

	if (hasValue) {
		console.log(`Todoist property found with value: ${frontMatter[todoistProperty]}.Returning ${hasValue}`);
	} else {
		console.log(`Todoist property is not defined or has no value. Returning ${hasValue}.`);
	}
	return hasValue
}

function checkTodoistPropertyHasValue(frontMatter, todoistPropertyName) {
	if (frontMatter && frontMatter.hasOwnProperty(todoistPropertyName)) {
		const value = frontMatter[todoistPropertyName];
		if (typeof value === 'string' && value.trim() !== '') {
			return true;
		}
	}
	return false;
}

const clearAllBadges = (fileItem) => {
	fileItem.coverEl.removeClass('todoist-indicator')
}

const paintFileBadge = (opts, fileItem) => {
	
	const slashes = fileItem.file.path.match(/\//g);
	const fileInFolder = slashes ? slashes.length > 1 : 0
	const folderItem = this.app.workspace.getLeavesOfType('file-explorer')[0].view.fileItems[fileItem.file.parent.path]


	const {TodoistLink} = opts || {}
 	
	if (!TodoistLink) {
		fileItem.coverEl.addClass('todoist-indicator')
		if (fileInFolder) { 
			folderItem.coverEl.addClass('todoist-indicator')
		}
	} else {
		clearAllBadges(fileItem)
		if (fileInFolder) { 
			clearAllBadges(folderItem)
		}
	}
}

function getFileByPath(filepath) {
	const files = this.app.vault.getFiles();
	const fileFound = files.find(file => file.path === filepath)
	if(fileFound){
		return fileFound
	} else {
		return "Not a file"
	}
}

function containsTag(file, tag) {
	
	const metadata = app.metadataCache.getFileCache(file).tags?.map(a => a.tag);
	
	// Check if the file contains the tag
	let containsTagFile = false
	if (Array.isArray(metadata)){

		if( metadata.filter(tg => tg.includes(tag)).length > 0) {
			//console.log(`The tag ${tag} is present in the file`)
			containsTagFile = true
  		} else {
			//console.log(`The tag ${tag} is not present in the file`)
			containsTagFile = false
  		}
	}

	// Check if the frontmatter contains the tag
	const frontMatterTags = app.metadataCache.getCache(file.path).frontmatter?.tags;
	let containstTagFrontMatter = false

	tagWithoutHash = tag.replace('#', '');

	if (Array.isArray(frontMatterTags)) {

		if (frontMatterTags.filter(tg => tg.includes(tagWithoutHash)).length > 0) {
			//console.log(`The tag ${tagWithoutHash} is present in the front matter.`)
			containstTagFrontMatter = true
		} else {
			//console.log(`The tag ${tagWithoutHash} is not present in the front matter.`)
			containstTagFrontMatter = false
		}
	}
	
	return containstTagFrontMatter || containsTagFile
}

module.exports = class TodoistLink extends Plugin {
	async onload() {
		await this.loadSettings()
		this.todoistProperty = this.settings.todoistProperty

		const handleEvent = (event, originalFilename) => {
			if (!this.isProjectFile(event.path) && (!originalFilename || !this.isProjectFile(originalFilename))) return
			this.updateFileCacheAndMaybeRepaintBadge(event, originalFilename).catch(error => {
				console.error('Error while handling event!', error)
			})
		}
		this.registerEvent(this.app.vault.on('delete', handleEvent))
		this.registerEvent(this.app.vault.on('rename', handleEvent))
		this.registerEvent(this.app.vault.on('modify', handleEvent))

		this.app.workspace.onLayoutReady(this.initialize)
		this.addSettingTab(new SettingTab(this.app, this))
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
	}

	isProjectFile = (filename) => {
		
		let hasProjectTag = false
		const file = getFileByPath(filename)

		if( file != "Not a file" ) {
			hasProjectTag = containsTag(file, this.settings.projectTag)
		}

		if( Boolean(this.settings.RequireProjectTag) ){
	
			return filename.startsWith(this.settings.projectsFolderPrefix)
			&& filename.endsWith('.md')
			&& !filename.includes('/_') 
			&& hasProjectTag
		} else { 
		 	return filename.startsWith(this.settings.projectsFolderPrefix)
		 	&& filename.endsWith('.md')
		 	&& !filename.includes('/_') 
		}
	}

	scheduleRepaintBadge = (path, clearAll) => {
		console.log(path)
		window.setTimeout(() => {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer')
			if (leaves?.[0]?.view?.fileItems?.[path]) {
				if (clearAll) clearAllBadges(leaves[0].view.fileItems[path])
				else paintFileBadge(this.settings.projectFileCache[path], leaves[0].view.fileItems[path])
			}
		})
	}

	updateFileCacheAndMaybeRepaintBadge = async ({path, stat, deleted}, originalFilename) => {
		if (deleted || !this.isProjectFile(path)) {
			delete this.settings.projectFileCache[path]
			delete this.settings.projectFileCache[originalFilename]
			await this.saveSettings()
			return this.scheduleRepaintBadge(path, true)
		}
		if (!deleted) {
			const string = await this.app.vault.cachedRead(
				this.app.vault.getAbstractFileByPath(path)
			)
			//console.log("string: "+string)

			const {TodoistLink} = this.settings.projectFileCache[path] || {}
			this.settings.projectFileCache[path] = this.settings.projectFileCache[path] || {}
			this.settings.projectFileCache[path].mtime = stat.mtime
						
			this.settings.projectFileCache[path].TodoistLink = findTodoistProperty(string, this.todoistProperty)

			await this.saveSettings()
			if (
				this.settings.projectFileCache[path].TodoistLink !== TodoistLink
			) this.scheduleRepaintBadge(path)
		}
	}

	refreshAllFileBadges = async () => {
		const projectFilesList = this
			.app
			.vault
			.getMarkdownFiles()
			.filter(f => this.isProjectFile(f.path))
		const filesMap = {}
		let needToSave = false
		for (const tFile of projectFilesList) {
			filesMap[tFile.path] = this.settings.projectFileCache[tFile.path] || {
				mtime: tFile.stat.mtime,
			}
			const lastCache = this.settings.projectFileCache[tFile.path]
			if (tFile.stat.mtime > (lastCache ? lastCache.mtime : 0)) {
				needToSave = true
				const string = await this.app.vault.cachedRead(tFile)
				//const { hasTodoistProperty } = this.containsTodoistLink(string)
				filesMap[tFile.path].TodoistLink = findTodoistProperty(string, this.todoistProperty)
			}
		}
		for (const path in this.settings.projectFileCache) if (!filesMap[path]) needToSave = true
		if (needToSave) {
			this.settings.projectFileCache = filesMap
			await this.saveSettings()
		}
		const leaves = this.app.workspace.getLeavesOfType('file-explorer')
	
		if (leaves?.length) {
			const fileItems = leaves[0].view?.fileItems || {}
			for (const f in fileItems) if (this.isProjectFile(f)) {
				//console.log(filesMap[f])
				paintFileBadge(filesMap[f], fileItems[f])
			}
		}
	}

	initialize = () => {
		this.refreshAllFileBadges().catch(error => {
			console.error('Unexpected error in "todoist-indicator" plugin initialization.', error)
		})
	}
}

class SettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display() {
		const {containerEl} = this
		containerEl.empty()

		containerEl.createEl('h2', { text: 'Todoist Indicator plugin Settings' });
		containerEl.createEl('p', { text: 'Please reload Obsidian after changeing these sesttings for them to take effect.' });
		new Setting(containerEl)
			.setName('Projects folder')
			.setDesc('The folder where project files live, e.g. "Projects/".')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectsFolderPrefix)
					.setValue(this.plugin.settings.projectsFolderPrefix)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolderPrefix = value
						await this.plugin.saveSettings()
					})
			)
		new Setting(containerEl)
			.setName('Todoist tag')
			.setDesc('The tag that indicates Todoist link.')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.todoistProperty)
					.setValue(this.plugin.settings.todoistProperty)
					.onChange(async (value) => {
						this.plugin.settings.todoistProperty = value
						await this.plugin.saveSettings()
					})
			)
		
		new Setting(containerEl)
			.setName('Require Project Tag?')
			.setDesc('With this setting enabled, badges will only appear on files (and their containing folder) with the project tag.')
			.addToggle(toggle => toggle
						.setValue(this.plugin.settings.RequireProjectTag)
						.onChange(async (value) => {
							this.plugin.settings.RequireProjectTag = value; 
							await this.plugin.saveSettings();
						})
			)
		new Setting(containerEl)
			.setName('Project tag')
			.setDesc('The tag that indicates a file is a project file (handy in case you  store project related files in a project folder).')
			.addText(
				text => text
					.setPlaceholder(DEFAULT_SETTINGS.projectTag)
					.setValue(this.plugin.settings.projectTag)
					.onChange(async (value) => {
						this.plugin.settings.projectTag = value
						await this.plugin.saveSettings()
					})
			)
	}
}
