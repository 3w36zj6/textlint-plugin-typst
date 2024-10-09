import type { TxtDocumentNode } from "@textlint/ast-node-types";
import type { TextlintPluginOptions } from "@textlint/types";
import { convertTypstSourceToTextlintAstObject } from "./typstToTextlintAst";

export class TypstProcessor {
	config: TextlintPluginOptions;
	extensions: Array<string>;
	constructor(config = {}) {
		this.config = config;
		this.extensions = this.config.extensions ? this.config.extensions : [];
	}

	availableExtensions() {
		return [".typ"].concat(this.extensions);
	}

	processor(_ext: string) {
		return {
			async preProcess(
				text: string,
				_filePath?: string,
			): Promise<TxtDocumentNode> {
				return await convertTypstSourceToTextlintAstObject(text);
			},
			// biome-ignore lint/suspicious/noExplicitAny: Allowing 'any' type for messages as the exact structure is not known.
			postProcess(messages: any[], filePath?: string) {
				return {
					messages,
					filePath: filePath ? filePath : "<typst>",
				};
			},
		};
	}
}
