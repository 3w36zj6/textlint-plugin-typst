import { createTypstCompiler } from "@myriaddreamin/typst.ts/dist/esm/compiler.mjs";
import {
	ASTNodeTypes,
	type TxtDocumentNode,
	type TxtNode,
	type TxtNodePosition,
	type TxtParentNode,
	type TxtTextNode,
} from "@textlint/ast-node-types";
import type { Content } from "@textlint/ast-node-types/lib/src/NodeType";
import { parse } from "yaml";

/**
 * Get the raw Typst AST string from a source string.
 * @param source The source string.
 * @returns The raw Typst AST string.
 */
export const getRawTypstAstString = async (source: string) => {
	const compiler = createTypstCompiler();
	await compiler.init();
	compiler.addSource("/main.typ", source);

	const rawTypstAstString = await compiler.getAst("/main.typ");

	return rawTypstAstString;
};

/**
 * Convert a raw Typst AST string to a Typst AST object.
 * @param rawTypstAstString The raw Typst AST string.
 * @returns The Typst AST object.
 */
export const convertRawTypstAstStringToObject = (rawTypstAstString: string) => {
	const removeFirstLine = (input: string): string => {
		const lines = input.split("\n");
		lines.shift();
		return lines.join("\n");
	};

	const escapeYamlValues = (yamlString: string): string => {
		return yamlString
			.split("\n")
			.reduce<string[]>((acc, line) => {
				// NOTE: If the line does not match the pattern, it is considered a continuation of the previous value.
				if (!/^\s*(path:|ast:|- s: |s: |c:)/.test(line)) {
					if (acc.length > 0) {
						acc[acc.length - 1] =
							`${acc[acc.length - 1].slice(0, -1)}\\n${line}"`;
					}
					return acc;
				}
				const [key, ...rest] = line.split(":");
				if (rest[0] === "") {
					acc.push(line);
					return acc;
				}
				const value = rest.join(":").trim();
				acc.push(`${key}: "${value}"`);
				return acc;
			}, [])
			.join("\n");
	};

	const escapedRawTypstAstYamlString = escapeYamlValues(
		removeFirstLine(rawTypstAstString),
	);

	const parsed = parse(escapedRawTypstAstYamlString);
	return parsed.ast as TypstAstNode;
};

/**
 * Convert a Typst AST node type to a textlint AST node type.
 * @param typstAstNodeType The Typst AST node type.
 * @returns The textlint AST node type.
 **/
export const convertTypstAstNodeTypeToTextlintNodeType = (
	typstAstNodeType: string,
): string => {
	// TODO: Add more mappings
	const nodeTypeMap: { [key: string]: string } = {
		"Marked::Heading": ASTNodeTypes.Header,
		"Marked::Text": ASTNodeTypes.Str,
		"Marked::Parbreak": ASTNodeTypes.Break,
	};
	return typstAstNodeType in nodeTypeMap
		? nodeTypeMap[typstAstNodeType]
		: typstAstNodeType;
};

interface TypstAstNode {
	s: string;
	c?: TypstAstNode[];
}

// Temporary AST node interface for converting Typst AST to textlint AST
interface AstNode {
	// Typst AST node properties
	s: string;
	c?: AstNode[];

	// textlint AST node properties
	type: string; //TxtNode["type"];
	raw: TxtNode["raw"];
	range: TxtNode["range"];
	loc: TxtNode["loc"];
	//parent?: TxtNode["parent"];

	value?: TxtTextNode["value"]; // If the node is a TxtTextNode
	children?: TxtParentNode["children"]; // If the node is a TxtParentNode
}

type TxtNodeLineLocation = TxtNode["loc"];

/**
 * Extract the raw source code from the specified location.
 * @param typstSource The raw Typst source code.
 * @param location The location specifying the start and end positions.
 * @returns The extracted source code.
 */
export const extractRawSourceByLocation = (
	typstSource: string,
	location: TxtNodeLineLocation,
): string => {
	const { start, end } = location;
	const lines = typstSource.split("\n");

	// NOTE: Line numbers are 1-based, but array indexes are 0-based.
	const targetLines = lines.slice(start.line - 1, end.line);

	const targetLinesFirst = targetLines[0].slice(start.column);
	const targetLinesMiddle = targetLines.slice(1, -1);
	const targetLinesLast = targetLines[targetLines.length - 1].slice(
		0,
		end.column,
	);
	let result: string;
	if (start.line === end.line) {
		result = targetLinesFirst.slice(0, end.column - start.column);
	} else {
		result = targetLinesFirst;
		if (targetLinesMiddle.length > 0) {
			result += `\n${targetLinesMiddle.join("\n")}`;
		}
		result += `\n${targetLinesLast}`;
	}

	return result;
};

/**
 * Convert a raw Typst AST object to a textlint AST object.
 * @param rawTypstAstObject The raw Typst AST object.
 * @returns The textlint AST object.
 **/
export const convertRawTypstAstObjectToTextlintAstObject = (
	rawTypstAstObject: TypstAstNode,
	typstSource: string,
) => {
	// Copy from rawTypstAstObject to textlintAstObject
	const textlintAstObject: AstNode = JSON.parse(
		JSON.stringify(rawTypstAstObject),
	);

	const parsePosition = (position: string): TxtNodePosition => {
		const [line, column] = position.split(":").map(Number);
		return {
			line,
			column,
		};
	};

	const extractNodeType = (s: string): string => {
		const match = s.match(
			/(?:<span style='color:[^']+'>([^<]+)<\/span>|([^<]+))/,
		);
		if (!match) throw new Error("Invalid format");
		return match[1] || match[2];
	};

	const extractLocation = (s: string, c?: AstNode[]): TxtNodeLineLocation => {
		const match = s.match(/&lt;(\d+:\d+)~(\d+:\d+)&gt;/);
		if (!match) {
			if (c !== undefined) {
				// If root node
				const rootChildrenStartLocation = extractLocation(c[0].s, c[0].c);
				const rootChildrenEndLocation = extractLocation(
					c[c.length - 1].s,
					c[c.length - 1].c,
				);
				return {
					start: rootChildrenStartLocation.start,
					end: rootChildrenEndLocation.end,
				};
			}
			throw new Error("Invalid format");
		}

		const startLocation = parsePosition(match[1]);
		const endLocation = parsePosition(match[2]);

		return {
			start: startLocation,
			end: endLocation,
		};
	};

	const calculateOffsets = (node: AstNode, currentOffset = 0): number => {
		const startOffset = currentOffset;

		const location = extractLocation(node.s, node.c);
		const nodeRawText = extractRawSourceByLocation(typstSource, location);
		const nodeLength = nodeRawText.length;

		if (node.c && node.c.length > 0) {
			// If TxtParentNode
			let childOffset = startOffset;
			const whitespaceNodes: TxtTextNode[] = [];
			const softBreakNodes: TxtTextNode[] = [];
			for (
				let nodeChildIndex = 0;
				nodeChildIndex < node.c.length;
				nodeChildIndex++
			) {
				const child = node.c[nodeChildIndex];
				childOffset = calculateOffsets(child, childOffset);

				// Check between child nodes
				if (nodeChildIndex < node.c.length - 1) {
					const nextChild = node.c[nodeChildIndex + 1];

					const currentEndLine = child.loc.end.line;
					const currentEndColumn = child.loc.end.column;
					const nextStartLine = extractLocation(nextChild.s, nextChild.c).start
						.line;
					const nextStartColumn = extractLocation(nextChild.s, nextChild.c)
						.start.column;

					// whitespace
					if (
						currentEndLine === nextStartLine &&
						currentEndColumn !== nextStartColumn
					) {
						const whitespaceNode: TxtTextNode = {
							type: "Str",
							raw: " ".repeat(nextStartColumn - currentEndColumn),
							value: " ".repeat(nextStartColumn - currentEndColumn),
							range: [childOffset, childOffset + 1],
							loc: {
								start: { line: currentEndLine, column: currentEndColumn },
								end: { line: nextStartLine, column: nextStartColumn },
							},
						};
						whitespaceNodes.push(whitespaceNode);
						childOffset += 1;
					}

					// soft breaks
					if (
						currentEndLine !== nextStartLine &&
						child.type !== ASTNodeTypes.Break &&
						nextChild.type !== ASTNodeTypes.Break
					) {
						const breakNode: TxtTextNode = {
							type: "Str",
							raw: "\n",
							value: "\n",
							range: [childOffset, childOffset + 1],
							loc: {
								start: { line: currentEndLine, column: currentEndColumn },
								end: { line: nextStartLine, column: nextStartColumn },
							},
						};
						softBreakNodes.push(breakNode);
						childOffset += 1;
					}
				}
			}

			node.c = node.c
				// @ts-expect-error
				.concat(softBreakNodes)
				// @ts-expect-error
				.concat(whitespaceNodes)
				.sort((a, b) => a.range[0] - b.range[0]);
			node.children = node.c as Content[];
		} else {
			// If TxtTextNode
			node.value = extractRawSourceByLocation(typstSource, location);
		}

		const endOffset = currentOffset + nodeLength;

		node.type = convertTypstAstNodeTypeToTextlintNodeType(
			extractNodeType(node.s),
		);
		node.raw = extractRawSourceByLocation(typstSource, location);
		node.range = [startOffset, endOffset];
		node.loc = location;

		if (node.type === "Marked::Raw") {
			if (node.loc.start.line === node.loc.end.line) {
				// If Code
				node.type = ASTNodeTypes.Code;
				node.value = node.raw.replace(/`([\s\S]*?)`/, "$1");
			} else {
				// If CodeBlock
				node.type = ASTNodeTypes.CodeBlock;
				node.value = node.raw.replace(/```(?:\w*)\n([\s\S]*?)\n```/, "$1");

				// @ts-expect-error
				node.lang =
					// @ts-expect-error
					node.children[1].type === "Marked::RawLang"
						? // @ts-expect-error
							node.children[1].value
						: null;
			}
			// biome-ignore lint/performance/noDelete: Convert TxtParentNode to TxtTextNode
			delete node.children;
		}

		// @ts-expect-error
		// biome-ignore lint/performance/noDelete: Typst AST object requires 's' property but textlint AST object does not.
		delete node.s;
		// biome-ignore lint/performance/noDelete: Typst AST object requires 'c' property but textlint AST object does not.
		delete node.c;

		return endOffset;
	};

	calculateOffsets(textlintAstObject);

	// Root node is always `Document` node
	textlintAstObject.type = ASTNodeTypes.Document;

	return textlintAstObject as TxtDocumentNode;
};

/**
 * Paragraphize a textlint AST object.
 * @param rootNode The textlint AST object.
 * @returns The paragraphized textlint AST object.
 */
export const paragraphizeTextlintAstObject = (
	rootNode: TxtDocumentNode,
): TxtDocumentNode => {
	const children: Content[] = [];
	let paragraph: Content[] = [];

	const pushChild = (paragraph: Content[]) => {
		if (paragraph.length === 0) return;

		const headNode = paragraph[0];
		const lastNode = paragraph[paragraph.length - 1];

		if (["Kw::Hash", "Fn::(Hash: &quot;#&quot;)"].includes(headNode.type)) {
			children.push(...paragraph);
			return;
		}

		children.push({
			loc: {
				start: headNode.loc.start,
				end: lastNode.loc.end,
			},
			range: [headNode.range[0], lastNode.range[1]],
			raw: paragraph.map((node) => node.raw).join(""),
			type: ASTNodeTypes.Paragraph,
			// @ts-expect-error
			children: paragraph,
		});
	};

	for (const node of rootNode.children) {
		switch (node.type) {
			case ASTNodeTypes.Header:
			case ASTNodeTypes.Break:
			case ASTNodeTypes.CodeBlock:
				pushChild(paragraph);
				paragraph = [];
				children.push(node);
				break;
			default:
				paragraph.push(node);
		}
	}
	pushChild(paragraph);

	return { ...rootNode, children };
};

/**
 * Convert a Typst source code to a textlint AST object.
 * @param typstSource The Typst source code.
 * @returns The textlint AST object.
 */
export const convertTypstSourceToTextlintAstObject = async (
	typstSource: string,
) => {
	const rawTypstAstString = await getRawTypstAstString(typstSource);
	const rawTypstAstObject = convertRawTypstAstStringToObject(rawTypstAstString);
	const textlintAstObject = convertRawTypstAstObjectToTextlintAstObject(
		rawTypstAstObject,
		typstSource,
	);
	const paragraphizedTextlintAstObject =
		paragraphizeTextlintAstObject(textlintAstObject);
	return paragraphizedTextlintAstObject as TxtDocumentNode;
};
