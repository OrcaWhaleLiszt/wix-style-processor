import {map, each, startsWith} from 'lodash';
import basicTransformations from './transformations';

const declarationRegex = /\s*([^:;{]+)\s*:\s*([^;}{]+)\s*/g;
const defaultVarDeclarationRegex = /--([^:{)]+):\s*"([^;{]+?)";?/g;
const innerQuotesRegex = /"([^"]+)"/g;
const transformRegex = /^(color|opacity|darken|string|join|number|font|increment|incrementer)\((.*)\)$/;
const singleTransformRegex = /^(\w*)\(([^()]+)\)$/;
const processParamsRegex = /,(?![^(]*\))/g;
const declarationBlocksRegex = /{{1}([^{}]*)}{1}/g;

function replacer(replacerParams,
                  plugins = {
                      valueTransformers: {},
                      declarationTransformers: []
                  }) {
    const {css, colors, fonts, numbers, strings} = replacerParams;

    const customVarContainers = {
        color: colors,
        font: fonts,
        number: numbers,
        string: strings
    };

    const defaultVarDeclarations = {};
    const declarationPlugins = plugins.declarationTransformers;
    const valuePlugins = plugins.valueTransformers;

    return replace();

    function replace() {
        scanDefaultVarDecls(css);

        let replacedCss = css.replace(declarationBlocksRegex, (decl, declarationBlock) =>
            '{' + declarationBlock.replace(declarationRegex, (decl, key, val) => {
                try {
                    return replaceDeclaration(key, val);
                } catch (err) {
                    console.error('failed replacing declaration', err);
                }

                return decl;
            }) + '}'
        );

        return replacedCss;
    }

    function scanDefaultVarDecls(css) {
        let match;

        while ((match = defaultVarDeclarationRegex.exec(css)) !== null) {
            let key = match[1];
            let val = match[2];
            defaultVarDeclarations[key] = val;
        }
    }

    function replaceDeclaration(key, val) {

        let replacedKey = key;
        let replacedVal = val;
        let innerMatch = replacedVal.match(innerQuotesRegex);

        ({replacedKey, replacedVal} = runDeclarationTransformers(replacedKey,
            replacedVal));

        if (innerMatch) {
            replacedVal = replaceInnerQuotes(replacedVal, innerMatch);
        }

        if (replacedVal[replacedVal.length - 1] === ';') {
            replacedVal = replacedVal.slice(0, -1);
        }

        return ` ${replacedKey}: ${replacedVal}`;
    }

    function replaceInnerQuotes(val, innerVals) {
        return innerVals.reduce((result, innerVal) => {
            let evaled = recursiveEval(innerVal.slice(1, -1));
            return result.replace(innerVal, evaled);
        }, val);
    }

    function recursiveEval(value) {
        const valueAsString = value.toString();
        const hasTransform = valueAsString.match(transformRegex);

        if (hasTransform) {
            const transformation = hasTransform[1];
            const params = hasTransform[2];
            const isSingleMatch = singleTransformRegex.test(valueAsString);

            let evaledParams = evalParameterList(params);

            if (isSingleMatch) {
                return singleEval(transformation, evaledParams);
            }

            return singleEval(transformation, evaledParams);
        } else {
            return singleEval(value);
        }
    }

    function evalParameterList(value) {
        let params = processParams(value);
        let evaledParams = map(params, p => recursiveEval(p));
        return evaledParams;
    }

    function singleEval(selectedTransformation, params = undefined) {
        let pluginTransformation = valuePlugins[selectedTransformation];
        let basicTransformation = basicTransformations[selectedTransformation];
        let transformation = pluginTransformation || basicTransformation;
        let result = invokeTransformation(transformation, params);

        if (!result && arguments.length === 1) {
            result = arguments[0];
        }

        return result;
    }

    function invokeTransformation(transformation, params) {
        return transformation &&
            transformation(params, replacerParams, evalCustomVar);
    }

    function getCustomVar(value) {
        return startsWith(value, '--') && value.substr(2, value.length - 2);
    }

    function evalCustomVar(transform, customVar) {
        customVar = getCustomVar(customVar);
        let valFromWix = customVarContainers[transform][customVar];
        let valFromDefault = defaultVarDeclarations[customVar];
        let val = valFromWix || valFromDefault;
        if (val) {
            let evaled = recursiveEval(val);
            return evaled;
        }
    }

    function processParams(params) {
        let match;
        let indices = [], args = [];

        while ((match = processParamsRegex.exec(params)) !== null) {
            indices.push(match.index);
        }

        let pos = 0;
        for (let i = 0; i < indices.length + 1; i++) {
            let idx = indices[i] || params.length;
            let arg = params.substr(pos, idx - pos);
            args.push(arg.trim());
            pos = idx + 1;
        }

        return args;
    }

    function runDeclarationTransformers(key, value) {
        each(declarationPlugins, plugin => {
            ({key, value} = plugin(key, value, replacerParams, evalCustomVar));
        });

        return {
            replacedKey: key,
            replacedVal: value
        };
    }
}

export default replacer;