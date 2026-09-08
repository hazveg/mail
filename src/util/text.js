/**
 * SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { convert } from 'html-to-text'
import isString from 'lodash/fp/isString.js'
import { curry } from 'ramda'

/**
 * @type {Text}
 */
export class Text {
	constructor(format, value) {
		this.format = format
		this.value = value
	}

	/**
	 * @param {Text} other other
	 * @return {Text}
	 */
	append(other) {
		if (this.format !== other.format) {
			throw new Error("can't append two different formats")
		}

		return new Text(this.format, this.value + other.value)
	}
}

/**
 * @param {string} format
 * @param {string} value
 * @return {object}
 */
const wrap = curry((format, value) => {
	return new Text(format, value)
})

/**
 * @param {string} value
 * @return {Text}
 */
export const plain = wrap('plain')

/**
 * @function
 * @param {string} value
 * @return {Text}
 */
export const html = wrap('html')

/**
 * @param {string} str
 * @return {Text}
 */
export function detect(str) {
	if (!isString(str)) {
		// Fall back to a hopefully sane default
		return plain('')
	}

	if (!str.includes('>')) {
		return plain(str)
	} else {
		return html(str)
	}
}

/**
 * Check whether an HTML string contains an inline image.
 *
 * Plain text can't carry images: toPlain() skips <img> entirely. Callers use
 * this to detect content that would be lost before converting it.
 *
 * @param {string} value HTML string
 * @return {boolean}
 */
export function containsImage(value) {
	return new DOMParser().parseFromString(value, 'text/html').querySelector('img') !== null
}

/**
 * @function
 * @param {string} format
 * @param {Text} text
 */
const isFormat = curry((format, text) => {
	return text.format === format
})

/**
 * @function
 * @param {Text} text
 * @return bool
 */
export const isPlain = isFormat('plain')

/**
 * @function
 * @param {Text} text
 * @return bool
 */
export const isHtml = isFormat('html')

/**
 * @param {Text} text text
 * @return {Text}
 */
export function toPlain(text) {
	if (text.format === 'plain') {
		return text
	}

	// Build shared options for all block tags
	const blockTags = ['p', 'div', 'header', 'footer', 'form', 'article', 'aside', 'main', 'nav', 'section']
	const blockSelectors = blockTags.map((tag) => ({
		selector: tag,
		format: 'customBlock',
		options: {
			preserveLeadingWhitespace: true,
		},
	}))

	const converted = convert(text.value, {
		wordwrap: false,
		formatters: {
			customBlock(elem, walk, builder, formatOptions) {
				builder.openBlock({
					isPre: formatOptions.preserveLeadingWhitespace,
					leadingLineBreaks: 0,
				})
				walk(elem.children, builder)
				builder.closeBlock({
					trailingLineBreaks: 0,
					blockTransform: (text) => text
						.replace(/^ {2,}/gm, ' '), // merge leading spaces
				})
				// Don't rely on the built-in leading/trailing line break feature.
				// Instead, we add a forced line break here because otherwise multiple
				// line breaks might be merged. But we want exactly one line break for
				// each closing tag.
				builder.addLineBreak()
			},
			customBlockQuote(elem, walk, builder, formatOptions) {
				builder.openBlock({
					leadingLineBreaks: formatOptions.leadingLineBreaks,
				})
				walk(elem.children, builder)
				builder.closeBlock({
					trailingLineBreaks: formatOptions.trailingLineBreaks,
					blockTransform: (text) => text
						.replace(/\n{3,}/g, '\n\n') // merge 3 or more line breaks
						.replace(/^/gm, '> '), // add quote marker at the start of each line
				})
			},
		},
		selectors: [
			{
				selector: 'img',
				format: 'skip',
			},
			{
				selector: 'a',
				options: {
					linkBrackets: false,
					ignoreHref: true,
				},
			},
			{
				selector: 'blockquote',
				format: 'customBlockQuote',
				options: {
					leadingLineBreaks: 0,
					trailingLineBreaks: 1,
				},
			},
			...blockSelectors,
		],
	})

	return plain(converted
		// trim leading line breaks
		.replace(/^\n+/, '')
		// trim trailing line breaks
		.replace(/\n+$/, '')
		// trim trailing spaces of each line
		.replace(/ +$/gm, '')
		// hack to create the correct email signature separator
		.replace(/^--$/gm, '-- '))
}

/**
 * @param {Text} text text
 * @return {Text}
 */
export function toHtml(text) {
	if (text.format === 'html') {
		return text
	}
	if (text.format === 'plain') {
		return html(text.value.replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br>$2'))
	}

	throw new Error(`Unknown format ${text.format}`)
}

function hslToHex(value) {
	const match = value.match(
		/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i,
	)

	if (!match) {
		return null
	}

	const h = Number(match[1]) / 360
	const s = Number(match[2]) / 100
	const l = Number(match[3]) / 100

	const hueToRgb = (p, q, t) => {
		if (t < 0) t += 1
		if (t > 1) t -= 1
		if (t < 1 / 6) return p + (q - p) * 6 * t
		if (t < 1 / 2) return q
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
		return p
	}

	if (s === 0) {
		const gray = Math.round(l * 255)
		return `#${gray.toString(16).padStart(2, '0').repeat(3)}`
	}

	const q = l < 0.5
		? l * (1 + s)
		: l + s - l * s
	const p = 2 * l - q

	const r = hueToRgb(p, q, h + 1 / 3)
	const g = hueToRgb(p, q, h)
	const b = hueToRgb(p, q, h - 1 / 3)

	return '#' + [r, g, b]
		.map((value) => Math.round(value * 255).toString(16).padStart(2, '0'))
		.join('')
}

/**
 * @param {Text} text text
 * @return {Text}
 */
export function normalizeColors(value) {
	return value.replace(
		/(color|background-color)\s*:\s*hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/gi,
		(match, property, h, s, l) => {
			const hex = hslToHex(`hsl(${h}, ${s}%, ${l}%)`)
			return hex ? `${property}:${hex}` : match
		},
	)
}
