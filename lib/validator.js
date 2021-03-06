"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
var __values = (this && this.__values) || function (o) {
    var m = typeof Symbol === "function" && o[Symbol.iterator], i = 0;
    if (m) return m.call(o);
    return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
Object.defineProperty(exports, "__esModule", { value: true });
var workingInput = null;
var workingInputTransform = [];
var stopValidation = false;
var resourcesSpec = require("./resourcesSpec");
var logger = require("./logger");
var parser = require("./parser");
var mockArnPrefix = "arn:aws:mock:region:123456789012:";
var awsData_1 = require("./awsData");
var awsData = require("./awsData");
var samData = require("./samData");
var docs = require("./docs");
var util = require("util");
var CustomError = require("./util/CustomError");
var sms = require("source-map-support");
sms.install();
var clone = require('clone');
var mergeOptions = require('merge-options');
var arrayIntersection = require('array-intersection');
var shajs = require('sha.js');
require('./util/polyfills');
var parameterRuntimeOverride = {};
var importRuntimeOverride = {};
var errorObject = {
    "templateValid": true,
    "errors": {
        "info": [],
        "warn": [],
        "crit": []
    },
    "outputs": {},
    "exports": {}
};
function resetValidator() {
    errorObject = { "templateValid": true, "errors": { "info": [], "warn": [], "crit": [] }, outputs: {}, exports: {} };
    workingInput = null;
    workingInputTransform = [];
    stopValidation = false;
    parameterRuntimeOverride = {};
    importRuntimeOverride = {};
}
exports.resetValidator = resetValidator;
;
var defaultValidateOptions = {
    guessParameters: undefined
};
function validateFile(path, options) {
    // Convert to object, this will throw an exception on an error
    workingInput = parser.openFile(path);
    // Let's go!
    return validateWorkingInput(options);
}
exports.validateFile = validateFile;
;
function validateJsonObject(obj, options) {
    workingInput = obj;
    return validateWorkingInput(options);
}
exports.validateJsonObject = validateJsonObject;
;
function addParameterValue(parameter, value) {
    addParameterOverride(parameter, value);
}
exports.addParameterValue = addParameterValue;
;
function addImportValue(parameter, value) {
    addImportOverride(parameter, value);
}
exports.addImportValue = addImportValue;
function addPseudoValue(parameter, value) {
    // Silently drop requests to change AWS::NoValue
    if (parameter == 'AWS::NoValue') {
        return;
    }
    // Only process items which are already defined in overrides
    if (parameter in awsData_1.awsRefOverrides) {
        // Put NotificationARNs in an array if required
        if (parameter == 'AWS::NotificationARNs') {
            if (awsData_1.awsRefOverrides['AWS::NotificationARNs'][0] == 'arn:aws:sns:us-east-1:123456789012:MyTopic') {
                awsData_1.awsRefOverrides['AWS::NotificationARNs'][0] = value;
            }
            else {
                awsData_1.awsRefOverrides['AWS::NotificationARNs'].push(value);
            }
        }
        else {
            // By default, replace the value
            awsData_1.awsRefOverrides[parameter] = value;
        }
    }
    else {
        addError('crit', parameter + " is not an allowed pseudo parameter", ['cli-options'], 'pseudo parameters');
    }
}
exports.addPseudoValue = addPseudoValue;
;
function addCustomResourceAttributeValue(resource, attribute, value) {
    var attrType = inferValueType(value, []);
    var newSpec = {
        'Attributes': (_a = {},
            _a[attribute] = {
                PrimitiveType: attrType,
                Value: value
            },
            _a)
    };
    // register resource type or logical name override
    if (!!~resource.indexOf('::')) {
        resourcesSpec.registerTypeOverride(resource, newSpec);
    }
    else {
        resourcesSpec.registerLogicalNameOverride(resource, newSpec);
    }
    var _a;
}
exports.addCustomResourceAttributeValue = addCustomResourceAttributeValue;
;
function addParameterOverride(parameter, value) {
    parameterRuntimeOverride[parameter] = value;
}
function addImportOverride(parameter, value) {
    importRuntimeOverride[parameter] = value;
}
function validateWorkingInput(passedOptions) {
    // Ensure we are working from a clean slate
    //exports.resetValidator();
    var options = Object.assign({}, defaultValidateOptions, passedOptions);
    // Check AWS Template Format Version
    if (workingInput.hasOwnProperty(['AWSTemplateFormatVersion'])) {
        var testValue = workingInput['AWSTemplateFormatVersion'];
        if (typeof workingInput['AWSTemplateFormatVersion'] == 'object') {
            addError('warn', 'AWSTemplateFormatVersion is recommended to be of type string \'2010-09-09\'', ['AWSTemplateFormatVersion'], 'AWSTemplateFormatVersion');
            testValue = testValue.toUTCString();
        }
        var allowedDateRegex = /^Thu, 09 Sep 2010 00:00:00 GMT$|^2010-09-09$/;
        if (!allowedDateRegex.test(testValue)) {
            addError('crit', 'AWSTemplateFormatVersion should be \'2010-09-09\'', ['AWSTemplateFormatVersion'], 'AWSTemplateFormatVersion');
        }
    }
    // Check Transform
    if (workingInput.hasOwnProperty(['Transform'])) {
        // assign defined transforms to the validator
        workingInputTransform = workingInput['Transform'];
        // initialize transform output
        if (!!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31')) {
            workingInput['SAMOutput'] = {};
        }
    }
    // TODO: Check keys for parameter are valid, ex. MinValue/MaxValue
    // Apply specification overrides
    applySpecificationOverrides();
    // Process SAM Globals section
    processSAMGlobals();
    // Apply template overrides
    applyTemplateOverrides();
    // Check parameters and assign outputs
    assignParametersOutput(options.guessParameters);
    // Evaluate Conditions
    assignConditionsOutputs();
    // Assign outputs to all the resources
    assignResourcesOutputs();
    if (stopValidation) {
        // Stop the validation early, we can't join stuff if we don't know what to expect
        if (process.env.DEBUG) {
            logger.error("Stopping validation early as a resource type is invalid.");
        }
        return errorObject;
    }
    // Use the outputs assigned to resources to resolve references
    resolveReferences();
    // Re-Apply template overrides
    applyTemplateOverrides();
    // Go through the hopefully resolved properties of each resource
    checkResourceProperties();
    // Assign template outputs to the error object
    collectOutputs();
    return errorObject;
}
function applySpecificationOverrides() {
    // extend resources specification with SAM specifics
    if (!!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31')) {
        resourcesSpec.extendSpecification(samData.samResources20161031);
    }
    // normalize Tag property type access
    var tagPropertyTypes = {};
    try {
        for (var _a = __values(Object.keys(awsData.awsResources['ResourceTypes'])), _b = _a.next(); !_b.done; _b = _a.next()) {
            var resourceKey = _b.value;
            tagPropertyTypes[resourceKey + ".Tag"] = awsData.awsResources['PropertyTypes']['Tag'];
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
        }
        finally { if (e_1) throw e_1.error; }
    }
    resourcesSpec.extendSpecification({ 'PropertyTypes': tagPropertyTypes });
    var e_1, _c;
}
/*
 * Validation and processing of the Globals section in SAM templates
 * Based on https//github.com/awslabs/serverless-application-model/blob/master/docs/globals.rst
 */
function processSAMGlobals() {
    if (!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31')) {
        return;
    }
    // process input
    if (workingInput.hasOwnProperty('Globals')) {
        var workingInputGlobals = workingInput['Globals'];
        if (!!workingInputGlobals && (typeof workingInputGlobals == 'object')) {
            try {
                for (var _a = __values(Object.keys(workingInputGlobals)), _b = _a.next(); !_b.done; _b = _a.next()) {
                    var resourceType = _b.value;
                    var resourceTemplate = workingInputGlobals[resourceType];
                    if (!!resourceTemplate) {
                        var targetType = void 0;
                        var allowedProperties = [];
                        switch (resourceType) {
                            case 'Function':
                                targetType = 'AWS::Serverless::Function';
                                allowedProperties = samData.samGlobals20161031.AllowedProperties[resourceType];
                                break;
                            case 'Api':
                                targetType = 'AWS::Serverless::Api';
                                allowedProperties = samData.samGlobals20161031.AllowedProperties[resourceType];
                                break;
                            case 'SimpleTable':
                                targetType = 'AWS::Serverless::SimpleTable';
                                allowedProperties = samData.samGlobals20161031.AllowedProperties[resourceType];
                                break;
                        }
                        if (!!targetType) {
                            var resourceProperties = Object.keys(resourceTemplate);
                            var inheritableProperties = {};
                            try {
                                // validate and extract properties that are inheritable by the given type
                                for (var resourceProperties_1 = __values(resourceProperties), resourceProperties_1_1 = resourceProperties_1.next(); !resourceProperties_1_1.done; resourceProperties_1_1 = resourceProperties_1.next()) {
                                    var resourceProperty = resourceProperties_1_1.value;
                                    if (!!~allowedProperties.indexOf(resourceProperty)) {
                                        inheritableProperties[resourceProperty] = resourceTemplate[resourceProperty];
                                    }
                                    else {
                                        addError('crit', "Invalid or unsupported SAM Globals property name: " + resourceProperty, ['Globals', resourceType], 'Globals');
                                    }
                                }
                            }
                            catch (e_2_1) { e_2 = { error: e_2_1 }; }
                            finally {
                                try {
                                    if (resourceProperties_1_1 && !resourceProperties_1_1.done && (_c = resourceProperties_1.return)) _c.call(resourceProperties_1);
                                }
                                finally { if (e_2) throw e_2.error; }
                            }
                            // override inheritable properties of matching resource type in template
                            var templateOverride = {
                                'Properties': inheritableProperties
                            };
                            if (workingInput.hasOwnProperty('Resources')) {
                                var workingInputResources = workingInput['Resources'];
                                if (!!workingInputResources && (typeof workingInputResources == 'object')) {
                                    try {
                                        for (var _d = __values(Object.keys(workingInputResources)), _e = _d.next(); !_e.done; _e = _d.next()) {
                                            var workingInputResource = _e.value;
                                            var WIRTemplate = workingInputResources[workingInputResource];
                                            if (!!WIRTemplate && (typeof WIRTemplate == 'object')) {
                                                if (WIRTemplate.hasOwnProperty('Type') &&
                                                    WIRTemplate['Type'] == targetType) {
                                                    Object.assign(WIRTemplate, mergeOptions(templateOverride, WIRTemplate));
                                                }
                                            }
                                        }
                                    }
                                    catch (e_3_1) { e_3 = { error: e_3_1 }; }
                                    finally {
                                        try {
                                            if (_e && !_e.done && (_f = _d.return)) _f.call(_d);
                                        }
                                        finally { if (e_3) throw e_3.error; }
                                    }
                                }
                            }
                        }
                        else {
                            addError('crit', "Invalid SAM Globals resource type: " + resourceType + ".", ['Globals'], 'Globals');
                        }
                    }
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (_b && !_b.done && (_g = _a.return)) _g.call(_a);
                }
                finally { if (e_4) throw e_4.error; }
            }
        }
    }
    var e_4, _g, e_2, _c, e_3, _f;
}
function inferPrimitiveValueType(v) {
    if (exports.isInteger(v)) {
        return 'Integer';
    }
    if (exports.isDouble(v)) {
        return 'Double';
    }
    if (exports.isBoolean(v)) {
        return 'Boolean';
    }
    if (exports.isJson(v)) {
        return 'Json';
    }
    if (exports.isTimestamp(v)) {
        return 'Timestamp';
    }
    if (exports.isString(v)) {
        return 'String';
    }
    return null;
}
function inferStructureValueType(v, candidateTypes) {
    var type = null;
    if (exports.isObject(v)) {
        if (v.hasOwnProperty('Type')) {
            var objectType = v['Type'];
            try {
                for (var _a = __values(candidateTypes), _b = _a.next(); !_b.done; _b = _a.next()) {
                    var candidateType = _b.value;
                    if (!!~candidateType.indexOf(objectType)) {
                        type = candidateType;
                    }
                }
            }
            catch (e_5_1) { e_5 = { error: e_5_1 }; }
            finally {
                try {
                    if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                }
                finally { if (e_5) throw e_5.error; }
            }
        }
        else {
            var objectKeys = [];
            if (v.hasOwnProperty('Properties')) {
                objectKeys = Object.keys(v['Properties']);
            }
            else {
                objectKeys = Object.keys(v);
            }
            var lastMatchCount = 0;
            try {
                for (var _d = __values(candidateTypes), _e = _d.next(); !_e.done; _e = _d.next()) {
                    var candidateType = _e.value;
                    var candidate = resourcesSpec.getType(candidateType);
                    var candidateKeys = Object.keys(candidate['Properties']);
                    var matchCount = arrayIntersection(objectKeys, candidateKeys).length;
                    if (matchCount > lastMatchCount) {
                        type = candidateType;
                        lastMatchCount = matchCount;
                    }
                }
            }
            catch (e_6_1) { e_6 = { error: e_6_1 }; }
            finally {
                try {
                    if (_e && !_e.done && (_f = _d.return)) _f.call(_d);
                }
                finally { if (e_6) throw e_6.error; }
            }
        }
    }
    return type;
    var e_5, _c, e_6, _f;
}
function inferAggregateValueType(v, candidateItemTypes) {
    var item = null;
    var type = null;
    var itemType = null;
    if (exports.isList(v)) {
        type = 'List';
        item = v[0];
    }
    else if (exports.isObject(v)) {
        type = 'Map';
        item = v[Object.keys(v)[0]];
    }
    if (!!item) {
        itemType = inferValueType(item, candidateItemTypes);
        // aggregate type nesting is not currently supported
        if (!!itemType && resourcesSpec.isAggregateType(itemType)) {
            itemType = 'Json';
        }
    }
    return (!!type && !!itemType) ? type + "<" + itemType + ">" : null;
}
function inferValueType(v, candidateTypes) {
    candidateTypes = candidateTypes.filter(function (x) { return !resourcesSpec.isPrimitiveType(x); });
    var candidateStructureTypes = candidateTypes.filter(function (x) {
        if (resourcesSpec.isParameterizedTypeFormat(x) &&
            resourcesSpec.isAggregateType(resourcesSpec.getParameterizedTypeName(x))) {
            return false;
        }
        return true;
    });
    var candidateAggregateTypes = candidateTypes.filter(function (x) {
        if (resourcesSpec.isParameterizedTypeFormat(x) &&
            resourcesSpec.isAggregateType(resourcesSpec.getParameterizedTypeName(x))) {
            return true;
        }
        return false;
    });
    candidateAggregateTypes = candidateAggregateTypes.map(function (x) { return resourcesSpec.getParameterizedTypeArgument(x); });
    var type = inferStructureValueType(v, candidateStructureTypes);
    if (!type) {
        type = inferAggregateValueType(v, candidateAggregateTypes);
        if (!type) {
            type = inferPrimitiveValueType(v);
        }
    }
    return type;
}
function formatCandidateTypes(baseType, candidateTypes) {
    // remove generic name part
    candidateTypes = candidateTypes.map(function (x) { return resourcesSpec.getParameterizedTypeArgument(x); });
    // format property types
    candidateTypes = candidateTypes.map(function (x) { return resourcesSpec.rebaseTypeFormat(baseType, x); });
    return candidateTypes;
}
function templateHasUnresolvedIntrinsics(template) {
    if (typeof template == 'object') {
        var templateKeys = Object.keys(template);
        var awsIntrinsicFunctionNames = Object.keys(awsData_1.awsIntrinsicFunctions);
        try {
            for (var templateKeys_1 = __values(templateKeys), templateKeys_1_1 = templateKeys_1.next(); !templateKeys_1_1.done; templateKeys_1_1 = templateKeys_1.next()) {
                var templateKey = templateKeys_1_1.value;
                var nestedTemplate = template[templateKey];
                if (!!~awsIntrinsicFunctionNames.indexOf(templateKey) || templateHasUnresolvedIntrinsics(nestedTemplate)) {
                    return true;
                }
            }
        }
        catch (e_7_1) { e_7 = { error: e_7_1 }; }
        finally {
            try {
                if (templateKeys_1_1 && !templateKeys_1_1.done && (_a = templateKeys_1.return)) _a.call(templateKeys_1);
            }
            finally { if (e_7) throw e_7.error; }
        }
    }
    return false;
    var e_7, _a;
}
function applySAMPropertyOverrides(baseType, baseName, type, name, spec, template) {
    // early exit for unsupported template or base type
    if (!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31') || !~baseType.indexOf('AWS::Serverless')) {
        return;
    }
    var localizedType = (baseType == type) ? baseType + "<" + baseName + ">" : baseType + "." + type + "<" + baseName + ">";
    // specialize property based on inferred Type
    var specType = spec['Type'];
    if (Array.isArray(specType)) {
        // skip if template has unresolved intrinsic functions
        if (templateHasUnresolvedIntrinsics(template)) {
            return;
        }
        var candidateTypes = formatCandidateTypes(baseType, specType);
        // infer property spec based on value in template
        var inferredCandidateType = void 0;
        if (!!(inferredCandidateType = inferValueType(template, candidateTypes))) {
            inferredCandidateType = inferredCandidateType.replace(baseType + ".", '');
            // determine spec based on a parameterized type matching the inferred candidate type
            if (resourcesSpec.hasProperty(localizedType, name + "<" + inferredCandidateType + ">")) {
                var candidateSpec = resourcesSpec.getProperty(localizedType, name + "<" + inferredCandidateType + ">");
                try {
                    // override property spec
                    for (var _a = __values(Object.keys(spec)), _b = _a.next(); !_b.done; _b = _a.next()) {
                        var property = _b.value;
                        if (!candidateSpec.hasOwnProperty(property)) {
                            delete spec[property];
                        }
                    }
                }
                catch (e_8_1) { e_8 = { error: e_8_1 }; }
                finally {
                    try {
                        if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                    }
                    finally { if (e_8) throw e_8.error; }
                }
                Object.assign(spec, clone(candidateSpec));
            }
        }
    }
    var e_8, _c;
}
function doSAMTransform(baseType, type, name, template, parentTemplate) {
    // early exit for unsupported template or base type
    if (!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31') || !~baseType.indexOf('AWS::Serverless')) {
        return;
    }
    // destructure name
    var nameParts = name.split('#');
    var logicalID = nameParts.shift();
    var propertyName = nameParts.shift();
    var itemID = nameParts.shift();
    // determine transform key
    var transformKey = baseType;
    if (!!propertyName) {
        transformKey = transformKey + "#" + propertyName;
    }
    if (!!itemID) {
        var itemType = type;
        transformKey = transformKey + "#ItemID<" + itemType + ">";
    }
    // determine available properties
    var localProperties = null;
    if (!!template && template.hasOwnProperty('Properties')) {
        localProperties = template['Properties'];
    }
    var parentProperties = null;
    if (!!parentTemplate && parentTemplate.hasOwnProperty('Properties')) {
        parentProperties = parentTemplate['Properties'];
    }
    // create supporting resources
    var output = workingInput['SAMOutput'];
    var transform = samData.samImplicitResources20161031[transformKey];
    if (!!transform) {
        var resourceTypes = Object.keys(transform);
        try {
            for (var resourceTypes_1 = __values(resourceTypes), resourceTypes_1_1 = resourceTypes_1.next(); !resourceTypes_1_1.done; resourceTypes_1_1 = resourceTypes_1.next()) {
                var resourceType = resourceTypes_1_1.value;
                // build resource logical ID
                var resourceLogicalID = transform[resourceType]['logicalId'];
                resourceLogicalID = resourceLogicalID.replace('<LogicalID>', logicalID);
                resourceLogicalID = resourceLogicalID.replace('<ItemID>', itemID);
                switch (transformKey) {
                    case 'AWS::Serverless::Function#AutoPublishAlias':
                        switch (resourceType) {
                            case 'AWS::Lambda::Alias':
                                if (!!parentProperties && parentProperties.hasOwnProperty('AutoPublishAlias')) {
                                    var autoPublishAlias = parentProperties['AutoPublishAlias'];
                                    resourceLogicalID = resourceLogicalID.replace('<AutoPublishAlias>', autoPublishAlias);
                                }
                                break;
                            case 'AWS::Lambda::Version':
                                // TODO: this may be non-deterministic and does not handle the case when CodeUri refers to local path
                                var codeDict = null;
                                if (!!parentProperties && parentProperties.hasOwnProperty('CodeUri')) {
                                    if (parentProperties['CodeUri'].hasOwnProperty('Bucket')) {
                                        codeDict['S3Bucket'] = parentProperties['CodeUri']['Bucket'];
                                    }
                                    if (parentProperties['CodeUri'].hasOwnProperty('Key')) {
                                        codeDict['S3Key'] = parentProperties['CodeUri']['Key'];
                                    }
                                    if (parentProperties['CodeUri'].hasOwnProperty('Version')) {
                                        codeDict['S3ObjectVersion'] = parentProperties['CodeUri']['Version'];
                                    }
                                }
                                else if (!!parentProperties && parentProperties.hasOwnProperty('InlineCode')) {
                                    codeDict['ZipFile'] = parentProperties['InlineCode'];
                                }
                                else {
                                    // TODO: perhaps raise validation error if neither CodeUri or InlineCode have been provided
                                }
                                if (!!codeDict) {
                                    codeDict = JSON.stringify(codeDict);
                                    var codeID = shajs('sha256').update(codeDict).digest('hex').substr(0, 10);
                                    resourceLogicalID = resourceLogicalID.replace('<CodeID>', codeID);
                                }
                                break;
                        }
                        break;
                    case 'AWS::Serverless::Function#Events#ItemID<ApiEvent>':
                        // TODO: we currently have no way of knowing the DefinitionID
                        break;
                    case 'AWS::Serverless::Api':
                        // TODO: this may be non-deterministic and does not handle the case when DefinitionUri refers to local path
                        switch (resourceType) {
                            case 'AWS::ApiGateway::Deployment':
                                var definition = null;
                                if (!!localProperties && localProperties.hasOwnProperty('DefinitionUri')) {
                                    // S3 object type
                                    if (!!localProperties['DefinitionUri'] && (typeof localProperties['DefinitionUri'] == 'object')) {
                                        definition = {};
                                        if (localProperties['DefinitionUri'].hasOwnProperty('Bucket')) {
                                            definition['Bucket'] = localProperties['DefinitionUri']['Bucket'];
                                        }
                                        if (localProperties['DefinitionUri'].hasOwnProperty('Key')) {
                                            definition['Key'] = localProperties['DefinitionUri']['Key'];
                                        }
                                        if (localProperties['DefinitionUri'].hasOwnProperty('Version')) {
                                            definition['Version'] = localProperties['DefinitionUri']['Version'];
                                        }
                                        // S3 protocol string
                                    }
                                    else {
                                        definition = localProperties['DefinitionUri'];
                                    }
                                }
                                else if (!!localProperties && localProperties.hasOwnProperty('DefinitionBody')) {
                                    definition = localProperties['DefinitionBody'];
                                }
                                else {
                                    // TODO: perhaps raise validation error if neither DefinitionUri or DefinitionBody have been provided
                                }
                                if (!!definition) {
                                    definition = JSON.stringify(definition);
                                    var definitionID = shajs('sha256').update(definition).digest('hex').substr(0, 10);
                                    resourceLogicalID = resourceLogicalID.replace('<DefinitionID>', definitionID);
                                }
                                break;
                            case 'AWS::ApiGateway::Stage':
                                if (!!localProperties && localProperties.hasOwnProperty('StageName')) {
                                    var stageName = localProperties['StageName'];
                                    resourceLogicalID = resourceLogicalID.replace('<StageName>', stageName);
                                }
                                break;
                        }
                        break;
                }
                // build resource template
                var resourceTemplate = {
                    'Type': resourceType,
                    'Attributes': {
                        'Ref': 'mockAttr_Ref' // some CFN definitions are missing the Ref attribute, so we force it here
                    }
                };
                var resourceSpec = resourcesSpec.getType(resourceType);
                if (resourceSpec.hasOwnProperty('Attributes')) {
                    try {
                        for (var _a = __values(Object.keys(resourceSpec['Attributes'])), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var attribute = _b.value;
                            var attributeValue = "mockAttr_" + attribute;
                            if (!!~attribute.indexOf('Arn')) {
                                attributeValue = mockArnPrefix;
                            }
                            resourceTemplate['Attributes'][attribute] = attributeValue;
                        }
                    }
                    catch (e_9_1) { e_9 = { error: e_9_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_9) throw e_9.error; }
                    }
                }
                // assign resource output
                output[resourceLogicalID] = resourceTemplate;
                // link supporting resource to referable property of source
                var sourceRefProperty = transform[resourceType]['refProperty'];
                if (!!sourceRefProperty) {
                    output[logicalID + "." + sourceRefProperty] = output[resourceLogicalID];
                }
            }
        }
        catch (e_10_1) { e_10 = { error: e_10_1 }; }
        finally {
            try {
                if (resourceTypes_1_1 && !resourceTypes_1_1.done && (_d = resourceTypes_1.return)) _d.call(resourceTypes_1);
            }
            finally { if (e_10) throw e_10.error; }
        }
    }
    var e_10, _d, e_9, _c;
}
function applyTemplatePropertyOverrides(baseType, baseName, type, name, spec, template, parentTemplate) {
    applySAMPropertyOverrides(baseType, baseName, type, name, spec, template);
    doSAMTransform(baseType, type, baseName + "#" + name, template, parentTemplate);
}
function applyTemplateTypeOverrides(baseType, type, name, template, parentTemplate) {
    // process type overrides
    doSAMTransform(baseType, type, name, template, parentTemplate);
    // early exit for invalid type
    var localizedType = (baseType == type) ? baseType + "<" + name + ">" : baseType + "." + type + "<" + name + ">";
    if (!resourcesSpec.hasType(localizedType)) {
        return;
    }
    // initialize specification override
    var originalSpec = resourcesSpec.getType(localizedType);
    var overrideSpec = clone(originalSpec);
    // determine properties section
    var templateProperties = template;
    if (baseType == type) {
        templateProperties = template['Properties'];
    }
    // apply property overrides
    if (!!templateProperties && (typeof templateProperties == 'object')) {
        try {
            for (var _a = __values(Object.keys(templateProperties)), _b = _a.next(); !_b.done; _b = _a.next()) {
                var propertyName = _b.value;
                // acquire property template
                var templateProperty = templateProperties[propertyName];
                if (!templateProperty) {
                    continue;
                }
                // process property
                var specProperty = overrideSpec['Properties'][propertyName];
                if (!!specProperty) {
                    applyTemplatePropertyOverrides(baseType, name, type, propertyName, specProperty, templateProperty, template);
                    // descend into nested types
                    if (specProperty.hasOwnProperty('ItemType')) {
                        var subType = specProperty['ItemType'];
                        try {
                            for (var _c = __values(Object.keys(templateProperty)), _d = _c.next(); !_d.done; _d = _c.next()) {
                                var subKey = _d.value;
                                var subTemplate = templateProperty[subKey];
                                applyTemplateTypeOverrides(baseType, subType, name + "#" + propertyName + "#" + subKey, subTemplate, template);
                            }
                        }
                        catch (e_11_1) { e_11 = { error: e_11_1 }; }
                        finally {
                            try {
                                if (_d && !_d.done && (_e = _c.return)) _e.call(_c);
                            }
                            finally { if (e_11) throw e_11.error; }
                        }
                    }
                    else if (specProperty.hasOwnProperty('Type')) {
                        var subType = specProperty['Type'];
                        applyTemplateTypeOverrides(baseType, subType, name + "#" + propertyName, templateProperty, template);
                    }
                }
            }
        }
        catch (e_12_1) { e_12 = { error: e_12_1 }; }
        finally {
            try {
                if (_b && !_b.done && (_f = _a.return)) _f.call(_a);
            }
            finally { if (e_12) throw e_12.error; }
        }
    }
    // register specification overrides
    if (JSON.stringify(originalSpec) !== JSON.stringify(overrideSpec)) {
        resourcesSpec.registerLogicalNameOverride(name, overrideSpec);
    }
    var e_12, _f, e_11, _e;
}
function applyTemplateOverrides() {
    // process input
    if (workingInput.hasOwnProperty('Resources')) {
        var workingInputResources = workingInput['Resources'];
        if (!!workingInputResources && (typeof workingInputResources == 'object')) {
            try {
                for (var _a = __values(Object.keys(workingInputResources)), _b = _a.next(); !_b.done; _b = _a.next()) {
                    var name = _b.value;
                    var template = workingInputResources[name];
                    if (!!template) {
                        if (template.hasOwnProperty('Type')) {
                            var type = template['Type'];
                            if (!!type) {
                                applyTemplateTypeOverrides(type, type, name, template, null);
                            }
                        }
                    }
                }
            }
            catch (e_13_1) { e_13 = { error: e_13_1 }; }
            finally {
                try {
                    if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                }
                finally { if (e_13) throw e_13.error; }
            }
        }
    }
    var e_13, _c;
}
function assignParametersOutput(guessParameters) {
    if (!workingInput.hasOwnProperty('Parameters')) {
        return false; // This isn't an issue
    }
    var guessAll = (guessParameters === undefined);
    var guessParametersSet = new Set(guessParameters || []);
    var _loop_1 = function (parameterName) {
        var parameter = workingInput['Parameters'][parameterName];
        if (!parameter.hasOwnProperty('Type')) {
            // We are going to assume type if a string to continue validation, but will throw a critical
            addError('crit', "Parameter " + parameterName + " does not have a Type defined.", ['Parameters', parameterName], "Parameters");
            parameter['Type'] = 'String';
        }
        // if the user hasn't specified any parameters to mock, assume all are ok; otherwise,
        // only mock the allowed ones.
        var okToGuess = (guessAll) || (guessParametersSet.has(parameterName));
        var parameterValue = inferParameterValue(parameterName, parameter, okToGuess);
        if (parameter.hasOwnProperty('AllowedValues') && parameter['AllowedValues'].indexOf(parameterValue) < 0) {
            addError('crit', "Parameter value '" + parameterValue + "' for " + parameterName + " is"
                + " not within the parameters AllowedValues", ['Parameters', parameterName], "Parameters");
        }
        if (parameter['Type'] === "CommaDelimitedList" && typeof parameterValue === 'string') {
            parameterValue = parameterValue.split(',').map(function (x) { return x.trim(); });
            parameterValue.forEach(function (val) {
                if (val === "") {
                    addError('crit', "Parameter " + parameterName + " contains a CommaDelimitedList where the number of commas appears to be equal or greater than the list of items.", ['Parameters', parameterName], "Parameters");
                }
            });
        }
        // The List<type> parameter value is inferred as string with comma delimited values and must be converted to array
        var listParameterTypesSpec = Object.keys(awsData_1.awsParameterTypes).filter(function (x) { return !!x.match(/List<.*>/); });
        if (!!~listParameterTypesSpec.indexOf(parameter['Type']) && (typeof parameterValue === 'string')) {
            parameterValue = parameterValue.split(',').map(function (x) { return x.trim(); });
            parameterValue.forEach(function (val) {
                if (val === "") {
                    addError('crit', "Parameter " + parameterName + " contains a List<" + parameter['Type'] + "> where the number of commas appears to be equal or greater than the list of items.", ['Parameters', parameterName], "Parameters");
                }
            });
        }
        // Assign an Attribute Ref regardless of any failures above
        workingInput['Parameters'][parameterName]['Attributes'] = {};
        workingInput['Parameters'][parameterName]['Attributes']['Ref'] = parameterValue;
    };
    // For through each parameter
    for (var parameterName in workingInput['Parameters']) {
        _loop_1(parameterName);
    }
}
function inferParameterValue(parameterName, parameter, okToGuess) {
    var parameterDefaultsByType = {
        'string': "string_input_" + parameterName,
        'array': undefined,
        'number': '42'
    };
    // Check if the Ref for the parameter has been defined at runtime
    var parameterOverride = parameterRuntimeOverride[parameterName];
    if (parameterOverride !== undefined) {
        // Check the parameter provided at runtime is within the allowed property list (if specified)
        return parameterOverride;
    }
    else if (parameter.hasOwnProperty('Default')) {
        // See if Default property is present and populate
        return parameter['Default'];
    }
    else {
        if (!okToGuess) {
            addError('crit', 'Value for parameter was not provided', ['Parameters', parameterName], 'Parameters');
        }
        if (parameter.hasOwnProperty('AllowedValues') && parameter['AllowedValues'].length > 0) {
            // See if AllowedValues has been specified
            return parameter['AllowedValues'][0];
        }
        else {
            var rawParameterType = parameter['Type'];
            var listMatch = /^List<(.+)>$/.exec(rawParameterType);
            var isList_1;
            var parameterType = void 0;
            if (listMatch) {
                isList_1 = true;
                parameterType = listMatch[1];
            }
            else {
                parameterType = rawParameterType;
                isList_1 = false;
            }
            if (!awsData_1.awsParameterTypes.hasOwnProperty(parameterType)) {
                addError('crit', "Parameter " + parameterName + " has an invalid type of " + rawParameterType + ".", ['Parameters', parameterName], "Parameters");
                parameterType = 'String';
            }
            var normalizedType = awsData_1.awsParameterTypes[parameterType];
            if (normalizedType == 'array') {
                isList_1 = true;
                parameterType = 'String';
                normalizedType = 'string';
            }
            var parameterDefault = parameterDefaultsByType[awsData_1.awsParameterTypes[parameterType]];
            if (isList_1) {
                return [parameterDefault];
            }
            else {
                return parameterDefault;
            }
        }
    }
}
function addError(severity, message, resourceStack, help) {
    if (resourceStack === void 0) { resourceStack = []; }
    if (help === void 0) { help = ''; }
    var obj = {
        'message': resourcesSpec.stripTypeParameters(message),
        'resource': resourceStack.join(' > '),
        'documentation': docs.getUrls(resourcesSpec.stripTypeParameters(help)).join(', ')
    };
    // Set the information
    errorObject.errors[severity].push(obj);
    // Template invalid if critical error
    if (severity == 'crit') {
        errorObject.templateValid = false;
    }
    // Debug
    if (process.env.DEBUG) {
        var strResourceStack = resourceStack.join(' > ');
        logger.debug("Error thrown: " + severity + ": " + message + " (" + strResourceStack + ")");
    }
}
function assignConditionsOutputs() {
    var allowedIntrinsicFunctions = ['Fn::And', 'Fn::Equals', 'Fn::If', 'Fn::Not', 'Fn::Or'];
    if (!workingInput.hasOwnProperty('Conditions')) {
        return;
    }
    // For through each condition
    placeInTemplate.push('Conditions');
    for (var cond in workingInput['Conditions']) {
        if (workingInput['Conditions'].hasOwnProperty(cond)) {
            placeInTemplate.push(cond);
            var condition = workingInput['Conditions'][cond];
            // Check the value of condition is an object
            if (typeof condition != 'object') {
                addError('crit', "Condition should consist of an intrinsic function of type " + allowedIntrinsicFunctions.join(', '), placeInTemplate, 'Conditions');
                workingInput['Conditions'][cond] = {};
                workingInput['Conditions'][cond]['Attributes'] = {};
                workingInput['Conditions'][cond]['Attributes']['Output'] = false;
            }
            else {
                // Check the value of this is Fn::And, Fn::Equals, Fn::If, Fn::Not or Fn::Or
                var keys = Object.keys(condition);
                if (allowedIntrinsicFunctions.indexOf(keys[0]) != -1) {
                    // Resolve recursively
                    var val = resolveIntrinsicFunction(condition, keys[0]);
                    // Check is boolean type
                    workingInput['Conditions'][cond]['Attributes'] = {};
                    workingInput['Conditions'][cond]['Attributes']['Output'] = false;
                    if (val === true || val === false) {
                        workingInput['Conditions'][cond]['Attributes']['Output'] = val;
                    }
                    else {
                        addError('crit', "Condition did not resolve to a boolean value, got " + val, placeInTemplate, 'Conditions');
                    }
                }
                else {
                    // Invalid intrinsic function
                    addError('crit', "Condition does not allow function '" + keys[0] + "' here", placeInTemplate, 'Conditions');
                }
            }
            placeInTemplate.pop();
        }
    }
    placeInTemplate.pop();
}
function assignResourcesOutputs() {
    if (!workingInput.hasOwnProperty('Resources')) {
        addError('crit', 'Resources section is not defined', [], "Resources");
        stopValidation = true;
        return false;
    }
    if (workingInput['Resources'].length == 0) {
        addError('crit', 'Resources is empty', [], "Resources");
        stopValidation = true;
        return false;
    }
    // For through each resource
    for (var res in workingInput['Resources']) {
        if (workingInput['Resources'].hasOwnProperty(res)) {
            // Check if Type is defined
            var resourceType = '';
            var spec = null;
            if (!workingInput['Resources'][res].hasOwnProperty('Type')) {
                stopValidation = true;
                addError('crit', "Resource " + res + " does not have a Type.", ['Resources', res], "Resources");
            }
            else {
                // Check if Type is valid
                resourceType = workingInput['Resources'][res]['Type'] + "<" + res + ">";
                try {
                    spec = resourcesSpec.getResourceType(resourceType);
                }
                catch (e) {
                    if (e instanceof resourcesSpec.NoSuchResourceType) {
                        addError('crit', "Resource " + res + " has an invalid Type of " + resourceType + ".", ['Resources', res], "Resources");
                    }
                    else {
                        throw e;
                    }
                }
            }
            // Create a map for storing the output attributes for this Resource
            var refValue = "mock-ref-" + res;
            var refOverride = resourcesSpec.getRefOverride(resourceType);
            if (refOverride !== null) {
                if (refOverride == "arn") {
                    refValue = mockArnPrefix + res;
                }
                else {
                    refValue = refOverride;
                }
            }
            // Create a return attributes for the resource, assume every resource has a Ref
            workingInput['Resources'][res]['Attributes'] = {};
            workingInput['Resources'][res]['Attributes']['Ref'] = refValue;
            //  Go through the attributes of the specification, and assign them
            if (spec != null && spec.Attributes) {
                for (var attr in spec.Attributes) {
                    var value = null;
                    // use user-defined attribute value if provided for the specific type
                    try {
                        var attrSpec = resourcesSpec.getResourceTypeAttribute(resourceType, attr);
                        if (attrSpec.hasOwnProperty('Value')) {
                            value = attrSpec['Value'];
                        }
                    }
                    catch (e) { }
                    // otherwise use an implicit mock value
                    if (!value) {
                        if (attr.indexOf('Arn') != -1) {
                            value = mockArnPrefix + res;
                        }
                        else {
                            value = "mockAttr_" + res;
                        }
                    }
                    workingInput['Resources'][res]['Attributes'][attr] = value;
                }
            }
        }
    }
}
function resolveReferences() {
    // TODO: Go through and resolve...
    // TODO: Ref, Attr, Join,
    // Resolve all Ref
    lastPositionInTemplate = workingInput;
    recursiveDecent(lastPositionInTemplate);
    var stop = workingInput;
}
var placeInTemplate = [];
var lastPositionInTemplate = null;
var lastPositionInTemplateKey = null;
function recursiveDecent(ref) {
    // Save the current variables to allow for nested decents
    var placeInTemplateX = placeInTemplate;
    var lastPositionInTemplateX = lastPositionInTemplate;
    var lastPositionInTemplateKeyX = lastPositionInTemplateKey;
    // Step into next attribute
    for (var i = 0; i < Object.keys(ref).length; i++) {
        var key = Object.keys(ref)[i];
        // Resolve the function
        if (awsData_1.awsIntrinsicFunctions.hasOwnProperty(key)) {
            // Check if an Intrinsic function is allowed here
            var inResourceProperty = (placeInTemplate[0] == "Resources" || placeInTemplate[2] == "Properties");
            var inResourceMetadata = (placeInTemplate[0] == "Resources" || placeInTemplate[2] == "Metadata");
            var inOutputs = (placeInTemplate[0] == "Outputs");
            var inConditions = (placeInTemplate[0] == "Conditions");
            // TODO Check for usage inside update policy
            if (!(inResourceProperty || inResourceMetadata || inOutputs || inConditions)) {
                addError("crit", "Intrinsic function " + key + " is not supported here", placeInTemplate, key);
            }
            else {
                // Resolve the function
                var functionOutput = resolveIntrinsicFunction(ref, key);
                if (functionOutput !== null && lastPositionInTemplateKey !== null) {
                    // Overwrite the position with the resolved value
                    lastPositionInTemplate[lastPositionInTemplateKey] = functionOutput;
                }
            }
        }
        else if (key != 'Attributes' && ref[key] instanceof Object) {
            placeInTemplate.push(key);
            lastPositionInTemplate = ref;
            lastPositionInTemplateKey = key;
            recursiveDecent(ref[key]);
        }
    }
    placeInTemplate.pop();
    // Restore the variables to support nested resolving
    placeInTemplate = placeInTemplateX;
    lastPositionInTemplate = lastPositionInTemplateX;
    lastPositionInTemplateKey = lastPositionInTemplateKeyX;
}
function resolveCondition(ref, key) {
    var toGet = ref[key];
    var condition = false;
    if (workingInput.hasOwnProperty('Conditions') && workingInput['Conditions'].hasOwnProperty(toGet)) {
        // Check the valid of the condition, returning argument 1 on true or 2 on failure
        if (typeof workingInput['Conditions'][toGet] == 'object') {
            if (workingInput['Conditions'][toGet].hasOwnProperty('Attributes') &&
                workingInput['Conditions'][toGet]['Attributes'].hasOwnProperty('Output')) {
                condition = workingInput['Conditions'][toGet]['Attributes']['Output'];
            } // If invalid, we will default to false, a previous error would have been thrown
        }
        else {
            condition = workingInput['Conditions'][toGet];
        }
    }
    else {
        addError('crit', "Condition '" + toGet + "' must reference a valid condition", placeInTemplate, 'Condition');
    }
    return condition;
}
function resolveIntrinsicFunction(ref, key) {
    switch (key) {
        case 'Ref':
            return doIntrinsicRef(ref, key);
        case 'Condition':
            return resolveCondition(ref, key);
        case 'Fn::Join':
            return doIntrinsicJoin(ref, key);
        case 'Fn::Base64':
            return doIntrinsicBase64(ref, key);
        case 'Fn::GetAtt':
            return doIntrinsicGetAtt(ref, key);
        case 'Fn::FindInMap':
            return doIntrinsicFindInMap(ref, key);
        case 'Fn::GetAZs':
            return doIntrinsicGetAZs(ref, key);
        case 'Fn::Sub':
            return doIntrinsicSub(ref, key);
        case 'Fn::If':
            return doIntrinsicIf(ref, key);
        case 'Fn::Equals':
            return doIntrinsicEquals(ref, key);
        case 'Fn::Or':
            return doIntrinsicOr(ref, key);
        case 'Fn::Not':
            return doIntrinsicNot(ref, key);
        case 'Fn::ImportValue':
            return doIntrinsicImportValue(ref, key);
        case 'Fn::Select':
            return doIntrinsicSelect(ref, key);
        case 'Fn::Split':
            return doInstrinsicSplit(ref, key);
        default:
            addError("warn", "Unhandled Intrinsic Function " + key + ", this needs implementing. Some errors might be missed.", placeInTemplate, "Functions");
            return null;
    }
}
function doIntrinsicRef(ref, key) {
    var refValue = ref[key];
    var resolvedVal = "INVALID_REF";
    // Check if it's of a String type
    if (typeof refValue != "string") {
        addError("crit", "Intrinsic Function Ref expects a string", placeInTemplate, "Ref");
    }
    else {
        // Check if the value of the Ref exists
        resolvedVal = getRef(refValue);
        if (resolvedVal === null) {
            addError('crit', "Referenced value " + refValue + " does not exist", placeInTemplate, "Ref");
            resolvedVal = "INVALID_REF";
        }
    }
    // Return the resolved value
    return resolvedVal;
}
function doIntrinsicBase64(ref, key) {
    // Only base64 encode strings
    var toEncode = ref[key];
    if (typeof toEncode != "string") {
        toEncode = resolveIntrinsicFunction(ref[key], Object.keys(ref[key])[0]);
        if (typeof toEncode != "string") {
            addError("crit", "Parameter of Fn::Base64 does not resolve to a string", placeInTemplate, "Fn::Base64");
            return "INVALID_FN_BASE64";
        }
    }
    // Return base64
    return Buffer.from(toEncode).toString('base64');
}
function doIntrinsicJoin(ref, key) {
    // Ensure that all objects in the join array have been resolved to string, otherwise
    // we need to resolve them.
    // Expect 2 parameters
    var join = ref[key][0];
    var parts = ref[key][1] || null;
    if (ref[key].length != 2 || parts == null) {
        addError('crit', 'Invalid parameters for Fn::Join', placeInTemplate, "Fn::Join");
        // Specify this as an invalid string
        return "INVALID_JOIN";
    }
    else {
        // Join
        return fnJoin(join, parts);
    }
}
function doIntrinsicGetAtt(ref, key) {
    var toGet = ref[key];
    if (toGet.length < 2) {
        addError("crit", "Invalid parameters for Fn::GetAtt", placeInTemplate, "Fn::GetAtt");
        return "INVALID_GET_ATT";
    }
    else {
        if (typeof toGet[0] != "string") {
            addError("crit", "Fn::GetAtt does not support functions for the logical resource name", placeInTemplate, "Fn::GetAtt");
        }
        // If we have more than 2 parameters, merge other parameters
        if (toGet.length > 2) {
            var root = toGet[0];
            var parts = toGet.slice(1).join('.');
            toGet = [root, parts];
        }
        // The AttributeName could be a Ref, so check if it needs resolving
        if (typeof toGet[1] != "string") {
            var keys = Object.keys(toGet[1]);
            if (keys[0] == "Ref") {
                toGet[1] = resolveIntrinsicFunction(toGet[1], "Ref");
            }
            else {
                addError("crit", "Fn::GetAtt only supports Ref within the AttributeName", placeInTemplate, "Fn::GetAtt");
            }
        }
        var attr = fnGetAtt(toGet[0], toGet[1]);
        if (attr != null) {
            return attr;
        }
        else {
            return "INVALID_REFERENCE_OR_ATTR_ON_GET_ATT";
        }
    }
}
function doIntrinsicFindInMap(ref, key) {
    var toGet = ref[key];
    if (toGet.length != 3) {
        addError("crit", "Invalid parameters for Fn::FindInMap", placeInTemplate, "Fn::FindInMap");
        return "INVALID_FN_FIND_IN_MAP";
    }
    else {
        for (var x in toGet) {
            if (toGet.hasOwnProperty(x)) {
                if (typeof toGet[x] != "string") {
                    toGet[x] = resolveIntrinsicFunction(toGet[x], Object.keys(toGet[x])[0]);
                }
            }
        }
        // Find in map
        var val = fnFindInMap(toGet[0], toGet[1], toGet[2]);
        if (val == null) {
            addError("crit", "Could not find value in map " + toGet[0] + "|" + toGet[1] + "|" + toGet[2] + ". Have you tried specifying input parameters?", placeInTemplate, "Fn::FindInMap");
            return "INVALID_MAPPING";
        }
        else {
            return val;
        }
    }
}
function doIntrinsicGetAZs(ref, key) {
    var toGet = ref[key];
    var region = awsData_1.awsRefOverrides['AWS::Region'];
    // If the argument is not a string, check it's Ref and resolve
    if (typeof toGet != "string") {
        var key_1 = Object.keys(toGet)[0];
        if (key_1 == "Ref") {
            if (toGet[key_1] != 'AWS::Region') {
                addError("warn", "Fn::GetAZs expects a region, ensure this reference returns a region", placeInTemplate, "Fn::GetAZs");
            }
            region = resolveIntrinsicFunction(toGet, "Ref");
        }
        else {
            addError("crit", "Fn::GetAZs only supports Ref or string as a parameter", placeInTemplate, "Fn::GetAZs");
        }
    }
    else {
        if (toGet != "") {
            region = toGet;
        }
    }
    // We now have a string, assume it's a real region
    // Lets create an array with 3 AZs
    var AZs = [];
    AZs.push(region + 'a');
    AZs.push(region + 'b');
    AZs.push(region + 'c');
    return AZs;
}
function doIntrinsicSelect(ref, key) {
    var toGet = ref[key];
    if (!Array.isArray(toGet) || toGet.length < 2) {
        addError('crit', "Fn::Select only supports an array of two elements", placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
    if (toGet[0] === undefined || toGet[0] === null) {
        addError('crit', "Fn::Select first element cannot be null or undefined", placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
    var index;
    if (typeof toGet[0] == 'object' && !Array.isArray(toGet[0])) {
        var keys = Object.keys(toGet[0]);
        if (awsData_1.awsIntrinsicFunctions['Fn::Select::Index']['supportedFunctions'].indexOf(keys[0]) != -1) {
            var resolvedIndex = resolveIntrinsicFunction(toGet[0], keys[0]);
            if (typeof resolvedIndex === 'string') {
                index = parseInt(resolvedIndex);
            }
            else if (typeof resolvedIndex === 'number') {
                index = resolvedIndex;
            }
            else {
                addError('crit', "Fn::Select's first argument did not resolve to a string for parsing or a numeric value.", placeInTemplate, "Fn::Select");
                return 'INVALID_SELECT';
            }
        }
        else {
            addError('crit', "Fn::Select does not support the " + keys[0] + " function in argument 1");
            return 'INVALID_SELECT';
        }
    }
    else if (typeof toGet[0] === 'string') {
        index = parseInt(toGet[0]);
    }
    else if (typeof toGet[0] === 'number') {
        index = toGet[0];
    }
    else {
        addError('crit', "Fn:Select's first argument must be a number or resolve to a number, it appears to be a " + typeof (toGet[0]), placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
    if (typeof index === undefined || typeof index !== 'number' || isNaN(index)) {
        addError('crit', "First element of Fn::Select must be a number, or it must use an intrinsic fuction that returns a number", placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
    if (toGet[1] === undefined || toGet[1] === null) {
        addError('crit', "Fn::Select Second element cannot be null or undefined", placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
    var list = toGet[1];
    if (!Array.isArray(list)) {
        //we may need to resolve it
        if (typeof list !== 'object') {
            addError('crit', "Fn::Select requires the second element to resolve to a list, it appears to be a " + typeof list, placeInTemplate, "Fn::Select");
            return 'INVALID_SELECT';
        }
        else if (typeof list == 'object') {
            var keys = Object.keys(list);
            if (awsData_1.awsIntrinsicFunctions['Fn::Select::List']['supportedFunctions'].indexOf(keys[0]) != -1) {
                list = resolveIntrinsicFunction(list, keys[0]);
            }
            else {
                addError('crit', "Fn::Select does not support the " + keys[0] + " function in argument 2");
                return 'INVALID_SELECT';
            }
            if (keys[0] === "Ref") {
                // check if it was a paramter which might be converted to a list
                var parameterName = toGet[1][keys[0]];
                if (workingInput['Parameters'][parameterName] !== undefined) {
                    list = workingInput['Parameters'][parameterName]['Attributes']['Ref'];
                }
            }
        }
        if (!Array.isArray(list)) {
            addError('crit', "Fn::Select requires the second element to be a list, function call did not resolve to a list. It contains value " + list, placeInTemplate, "Fn::Select");
            return 'INVALID_SELECT';
        }
    }
    else if (list.indexOf(null) > -1) {
        addError('crit', "Fn::Select requires that the list be free of null values", placeInTemplate, "Fn::Select");
    }
    if (index >= 0 && index < list.length) {
        return list[index];
    }
    else {
        addError('crit', "First element of Fn::Select exceeds the length of the list.", placeInTemplate, "Fn::Select");
        return 'INVALID_SELECT';
    }
}
/**
 * Resolves the string part of the `Fn::Sub` intrinsic function into mappings of placeholders and their corresponding CFN
 * literal values or intrinsic functions, according to the provided list of `Fn::Sub` specific variables; the resulting intrinsic
 * functions are compatible with and can later be resolved using the `resolveIntrinsicFunction` function.
 * e.g.: `{ '${AWS::Region}': {'Ref': 'AWS::Region'} }`.
 */
function parseFnSubStr(sub, vars) {
    if (vars === void 0) { vars = {}; }
    // Extract the placeholders within the ${} and store in matches
    var regex = /\${([A-Za-z0-9:.!]+)}/gm;
    var matches = [];
    var match;
    while (match = regex.exec(sub)) {
        matches.push(match[1]);
    }
    // Process each of the matches into a literal value or an intrinsic function
    var results = {};
    try {
        for (var matches_1 = __values(matches), matches_1_1 = matches_1.next(); !matches_1_1.done; matches_1_1 = matches_1.next()) {
            var m = matches_1_1.value;
            var result = null;
            // literal value
            if (m.indexOf('!') == 0) {
                result = m.substring(1);
                // Fn::Sub variable value
            }
            else if (vars.hasOwnProperty(m)) {
                result = m;
                // Fn::GetAtt intrinsic function
            }
            else if (resourcesSpec.isPropertyTypeFormat(m)) {
                result = {
                    'Fn::GetAtt': [
                        resourcesSpec.getPropertyTypeBaseName(m),
                        resourcesSpec.getPropertyTypePropertyName(m),
                    ]
                };
                // Ref intrinsic function
            }
            else {
                result = {
                    'Ref': m
                };
            }
            results[m] = result;
        }
    }
    catch (e_14_1) { e_14 = { error: e_14_1 }; }
    finally {
        try {
            if (matches_1_1 && !matches_1_1.done && (_a = matches_1.return)) _a.call(matches_1);
        }
        finally { if (e_14) throw e_14.error; }
    }
    return results;
    var e_14, _a;
}
function doIntrinsicSub(ref, key) {
    var toGet = ref[key];
    var replacementStr = null;
    var definedParams = null;
    // We have a simple replace
    // Ex. !Sub MyInput-${AWS::Region}
    if (typeof toGet == 'string') {
        replacementStr = toGet;
    }
    else {
        // We should have an array of parameters
        // Ex.
        // Prop: !Sub
        // - "MyInput-${Something}-${Else}
        // - Something: aa
        //   Else: bb
        if (toGet[0]) {
            // Check the given values are the correct types for an array style Sub, otherwise
            // throw errors.
            if (typeof toGet[0] == 'string') {
                replacementStr = toGet[0];
            }
            else {
                addError('crit', 'Fn::Sub expects first argument to be a string', placeInTemplate, 'Fn::Sub');
            }
            if (typeof toGet[1] == 'object') {
                definedParams = toGet[1];
            }
            else {
                addError('crit', 'Fn::Sub expects second argument to be a variable map', placeInTemplate, 'Fn::Sub');
            }
        }
        else {
            addError('crit', 'Fn::Sub function malformed, first array element should be present', placeInTemplate, "Fn::Sub");
        }
    }
    var placeholderValues = parseFnSubStr(replacementStr, definedParams ? definedParams : {});
    // do rendition
    for (var placeholder in placeholderValues) {
        var placeholderValue = placeholderValues[placeholder];
        // resolve intrinsics
        if (typeof placeholderValue == 'object') {
            var fnName = Object.keys(placeholderValue)[0];
            placeholderValue = resolveIntrinsicFunction(placeholderValue, fnName);
        }
        if (placeholderValue == 'INVALID_REFERENCE_OR_ATTR_ON_GET_ATT' || placeholderValue == null) {
            addError('crit', "Intrinsic Sub does not reference a valid resource, attribute nor mapping '" + placeholder + "'.", placeInTemplate, 'Fn::Sub');
        }
        replacementStr = replacementStr.replace(placeholder, placeholderValue);
    }
    // Set the resolved value as a string
    return replacementStr;
}
function doIntrinsicIf(ref, key) {
    var toGet = ref[key];
    // Check the value of the condition
    if (toGet.length == 3) {
        // Check toGet[0] is a valid condition
        toGet[0] = resolveCondition({ 'Condition': toGet[0] }, 'Condition');
        // Set the value
        var value = null;
        if (toGet[0]) {
            value = toGet[1];
        }
        else {
            value = toGet[2];
        }
        if (value instanceof Array) {
            // Go through each element in the array, resolving if needed.
            var resolvedValue = [];
            for (var i = 0; i < value.length; i++) {
                var keys = Object.keys(value[i]);
                if (awsData_1.awsIntrinsicFunctions['Fn::If']['supportedFunctions'].indexOf(keys[0]) !== -1) {
                    resolvedValue.push(resolveIntrinsicFunction(value[i], keys[0]));
                }
                else {
                    addError('crit', "Fn::If does not allow " + keys[0] + " as a nested function within an array", placeInTemplate, 'Fn::If');
                }
            }
            // Return the resolved array
            return resolvedValue;
        }
        else if (typeof value === "object") {
            var keys = Object.keys(value);
            if (awsData_1.awsIntrinsicFunctions['Fn::If']['supportedFunctions'].indexOf(keys[0]) !== -1) {
                return resolveIntrinsicFunction(value, keys[0]);
            }
            else {
                // TODO: Do we need to make sure this isn't an attempt at an invalid supportedFunction?
                recursiveDecent(value);
                return value;
            }
        }
        else {
            return value;
        }
    }
    else {
        addError('crit', "Fn::If must have 3 arguments, only " + toGet.length + " given.", placeInTemplate, 'Fn::If');
    }
    // Set the 1st or 2nd param as according to the condition
    return "INVALID_IF_STATEMENT";
}
function doIntrinsicEquals(ref, key) {
    var toGet = ref[key];
    // Check the value of the condition
    if (toGet.length == 2) {
        // Resolve first argument
        if (typeof toGet[0] == 'object') {
            var keys = Object.keys(toGet[0]);
            if (awsData_1.awsIntrinsicFunctions['Fn::If']['supportedFunctions'].indexOf(keys[0]) != -1) {
                toGet[0] = resolveIntrinsicFunction(toGet[0], keys[0]);
            }
            else {
                addError('crit', "Fn::Equals does not support the " + keys[0] + " function in argument 1");
            }
        }
        // Resolve second argument
        if (typeof toGet[1] == 'object') {
            var keys = Object.keys(toGet[1]);
            if (awsData_1.awsIntrinsicFunctions['Fn::If']['supportedFunctions'].indexOf(keys[0]) != -1) {
                toGet[0] = resolveIntrinsicFunction(toGet[1], keys[0]);
            }
            else {
                addError('crit', "Fn::Equals does not support the " + keys[1] + " function in argument 2");
            }
        }
        // Compare
        return (toGet[0] == toGet[1]);
    }
    else {
        addError('crit', "Fn::Equals expects 2 arguments, " + toGet.length + " given.", placeInTemplate, 'Fn::Equals');
    }
    return false;
}
function doIntrinsicOr(ref, key) {
    var toGet = ref[key];
    // Check the value of the condition
    if (toGet.length > 1 && toGet.length < 11) {
        var argumentIsTrue = false;
        // Resolve each argument
        for (var arg in toGet) {
            if (toGet.hasOwnProperty(arg)) {
                if (typeof toGet[arg] == 'object') {
                    var keys = Object.keys(toGet[arg]);
                    if (awsData_1.awsIntrinsicFunctions['Fn::Or']['supportedFunctions'].indexOf(keys[0]) != -1) {
                        toGet[arg] = resolveIntrinsicFunction(toGet[arg], keys[0]);
                    }
                    else {
                        addError('crit', "Fn::Or does not support function '" + keys[0] + "' here", placeInTemplate, 'Fn::Or');
                    }
                }
                // Set to true if needed
                if (toGet[arg] === true) {
                    argumentIsTrue = true;
                }
            }
        }
        return argumentIsTrue;
    }
    else {
        addError('crit', "Expecting Fn::Or to have between 2 and 10 arguments", placeInTemplate, 'Fn::Or');
    }
}
function doIntrinsicNot(ref, key) {
    var toGet = ref[key];
    // Check the value of the condition
    if (toGet.length == 1) {
        // Resolve if an object
        if (typeof toGet[0] == 'object') {
            var keys = Object.keys(toGet[0]);
            if (awsData_1.awsIntrinsicFunctions['Fn::Not']['supportedFunctions'].indexOf(keys[0]) != -1) {
                toGet[0] = resolveIntrinsicFunction(toGet[0], keys[0]);
            }
            else {
                addError('crit', "Fn::Not does not support function '" + keys[0] + "' here", placeInTemplate, 'Fn::Or');
            }
        }
        // Negate
        if (toGet[0] === true || toGet[0] === false) {
            return !toGet[0];
        }
        else {
            addError('crit', "Fn::Not did not resolve to a boolean value, " + toGet[0] + " given", placeInTemplate, 'Fn::Not');
        }
    }
    else {
        addError('crit', "Expecting Fn::Not to have exactly 1 argument", placeInTemplate, 'Fn::Not');
    }
    return false;
}
function doIntrinsicImportValue(ref, key) {
    var toGet = ref[key];
    // If not string, resolve using the supported functions
    if (typeof toGet == 'object') {
        var keys = Object.keys(toGet);
        if (awsData_1.awsIntrinsicFunctions['Fn::ImportValue']['supportedFunctions'].indexOf(keys[0]) != -1) {
            toGet = resolveIntrinsicFunction(toGet, keys[0]);
        }
        else {
            addError('crit', "Fn::ImportValue does not support function '" + keys[0] + "' here", placeInTemplate, 'Fn::ImportValue');
            return 'INVALID_FN_IMPORTVALUE';
        }
    }
    // Resolve
    if (typeof toGet == 'string') {
        var importValue = importRuntimeOverride[toGet];
        if (importValue !== undefined) {
            return importValue;
        }
        // If an import wasn't provided, construct a default value for backwards compatibility
        return "IMPORTEDVALUE" + toGet;
    }
    else {
        addError('warn', "Something went wrong when resolving references for a Fn::ImportValue", placeInTemplate, 'Fn::ImportValue');
        return 'INVALID_FN_IMPORTVALUE';
    }
}
function doInstrinsicSplit(ref, key) {
    var args = ref[key];
    if (!Array.isArray(args) || args.length !== 2) {
        addError('crit', 'Invalid parameter for Fn::Split. It needs an Array of length 2.', placeInTemplate, 'Fn::Split');
        return ['INVALID_SPLIT'];
    }
    var delimiter = args[0];
    if (typeof delimiter !== 'string') {
        addError('crit', "Invalid parameter for Fn::Split. The delimiter, " + util.inspect(delimiter) + ", needs to be a string.", placeInTemplate, 'Fn::Split');
        return ['INVALID_SPLIT'];
    }
    var stringOrInstrinsic = args[1];
    var stringToSplit;
    if (typeof stringOrInstrinsic === 'object') {
        var fnName = Object.keys(stringOrInstrinsic)[0];
        if (awsData_1.awsIntrinsicFunctions['Fn::Split']['supportedFunctions'].indexOf(fnName) == -1) {
            addError('crit', "Fn::Split does not support function '" + fnName + "' here", placeInTemplate, 'Fn::Split');
            return ['INVALID_SPLIT'];
        }
        stringToSplit = resolveIntrinsicFunction(stringOrInstrinsic, fnName);
    }
    else if (typeof stringOrInstrinsic === 'string') {
        stringToSplit = stringOrInstrinsic;
    }
    else {
        addError('crit', "Invalid parameters for Fn::Split. The parameter, " + stringOrInstrinsic + ", needs to be a string or a supported intrinsic function.", placeInTemplate, 'Fn::Split');
        return ['INVALID_SPLIT'];
    }
    return fnSplit(delimiter, stringToSplit);
}
exports.doInstrinsicSplit = doInstrinsicSplit;
function fnSplit(delimiter, stringToSplit) {
    return stringToSplit.split(delimiter);
}
function fnJoin(join, parts) {
    // Resolve instrinsic functions that return the parts array
    if (!Array.isArray(parts)) {
        // TODO Check the key is within the valid functions which can be called from a Fn::Join
        parts = resolveIntrinsicFunction(parts, Object.keys(parts)[0]);
        if (!Array.isArray(parts)) {
            addError('crit', 'Invalid parameters for Fn::Join', placeInTemplate, "Fn::Join");
            // Specify this as an invalid string
            return "INVALID_JOIN";
        }
    }
    // Otherwise go through each parts and ensure they are resolved
    for (var p in parts) {
        if (parts.hasOwnProperty(p)) {
            if (typeof parts[p] == "object") {
                // Something needs resolving
                // TODO Check the key is within the valid functions which can be called from a Fn::Join
                parts[p] = resolveIntrinsicFunction(parts[p], Object.keys(parts[p])[0]);
            }
        }
    }
    return parts.join(join);
}
function fnGetAtt(reference, attributeName) {
    // determine resource template
    var resource;
    if (!!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31') &&
        workingInput['SAMOutput'].hasOwnProperty(reference)) {
        resource = workingInput['SAMOutput'][reference];
    }
    else if (workingInput['Resources'].hasOwnProperty(reference)) {
        resource = workingInput['Resources'][reference];
    }
    else {
        addError('crit', "No resource with logical name of " + reference + "!", placeInTemplate, reference);
    }
    // determine attribute value
    if (!!resource) {
        var resourceType = resource['Type'] + "<" + reference + ">";
        try {
            // Lookup attribute
            var attribute = resourcesSpec.getResourceTypeAttribute(resourceType, attributeName);
            var primitiveAttribute = attribute;
            if (!!primitiveAttribute['PrimitiveType']) {
                return resource['Attributes'][attributeName];
            }
            var listAttribute = attribute;
            if (listAttribute['Type'] == 'List') {
                return [resource['Attributes'][attributeName], resource['Attributes'][attributeName]];
            }
        }
        catch (e) {
            // Coerce missing custom resource attribute value to string
            if ((resourceType.indexOf('Custom::') == 0) ||
                (resourceType.indexOf('AWS::CloudFormation::CustomResource') == 0) ||
                (resourceType.indexOf('AWS::CloudFormation::Stack') == 0)) {
                return "mockAttr_" + reference + "_" + attributeName;
            }
            if (e instanceof resourcesSpec.NoSuchResourceTypeAttribute) {
                addError('crit', e.message, placeInTemplate, resourceType);
            }
            else {
                throw e;
            }
        }
    }
    // Return null if not found
    return null;
}
exports.fnGetAtt = fnGetAtt;
function fnFindInMap(map, first, second) {
    if (workingInput.hasOwnProperty('Mappings')) {
        if (workingInput['Mappings'].hasOwnProperty(map)) {
            if (workingInput['Mappings'][map].hasOwnProperty(first)) {
                if (workingInput['Mappings'][map][first].hasOwnProperty(second)) {
                    return workingInput['Mappings'][map][first][second];
                }
            }
        }
    }
    return null;
}
function getRef(reference) {
    // Check in SAMOutput
    if (!!~workingInputTransform.indexOf('AWS::Serverless-2016-10-31') &&
        workingInput['SAMOutput'].hasOwnProperty(reference)) {
        return workingInput['SAMOutput'][reference]['Attributes']['Ref'];
        // Check in Resources
    }
    else if (workingInput['Resources'].hasOwnProperty(reference)) {
        return workingInput['Resources'][reference]['Attributes']['Ref'];
    }
    // Check in Parameters
    if (workingInput['Parameters'] && workingInput['Parameters'].hasOwnProperty(reference)) {
        return workingInput['Parameters'][reference]['Attributes']['Ref'];
    }
    // Check for customs refs
    if (awsData_1.awsRefOverrides.hasOwnProperty(reference)) {
        return awsData_1.awsRefOverrides[reference];
    }
    // We have not found a ref
    return null;
}
function getImportValue(reference) {
    if (workingInput['Imports'] && workingInput['Imports'].hasOwnProperty(reference)) {
        return workingInput['Imports'][reference];
    }
}
function collectOutputs() {
    placeInTemplate.push('Outputs');
    var outputs = workingInput['Outputs'] || {};
    for (var outputName in outputs) {
        placeInTemplate.push(outputName);
        try {
            var output = outputs[outputName];
            var outputValue = output['Value'];
            if (outputValue === undefined) {
                continue;
            }
            errorObject['outputs'][outputName] = outputValue;
            if (output['Export']) {
                var exportName = output['Export']['Name'];
                if (!exportName) {
                    addError('crit', "Output " + outputName + " exported with no Name", placeInTemplate, 'Outputs');
                    continue;
                }
                errorObject['exports'][exportName] = outputValue;
            }
        }
        finally {
            placeInTemplate.pop();
        }
    }
    placeInTemplate.pop();
}
var baseResourceType = null;
/**
 * get the name of the ResourceType or PropertyType that this ObjectType refers to.
 */
function getTypeName(objectType) {
    switch (objectType.type) {
        case 'RESOURCE':
            return objectType.resourceType;
        case 'PROPERTY':
            return resourcesSpec.getPropertyType(objectType.resourceType, objectType.parentType, objectType.propertyName);
        case 'PROPERTY_TYPE':
            return objectType.propertyType;
        default:
            throw new Error('unknown type!');
    }
}
/**
 *
 */
function getItemType(objectType) {
    var maybePrimitiveType = resourcesSpec.getPrimitiveItemType(objectType.parentType, objectType.propertyName);
    var maybePropertyType = resourcesSpec.getItemType(objectType.resourceType, objectType.parentType, objectType.propertyName);
    if (maybePrimitiveType) {
        return {
            type: 'PRIMITIVE_TYPE',
            primitiveType: maybePrimitiveType,
            resourceType: objectType.resourceType
        };
    }
    else if (maybePropertyType) {
        return {
            type: 'PROPERTY_TYPE',
            propertyType: maybePropertyType,
            resourceType: objectType.resourceType
        };
    }
    else {
        throw new Error(objectType.parentType + "." + objectType.propertyName + " is not a container type, but we tried to get an item type for it anyway.");
    }
}
function checkResourceProperties() {
    // Go into resources
    placeInTemplate.push('Resources');
    var resources = workingInput['Resources'];
    // Go through each resource
    for (var res in resources) {
        var resourceType = resources[res]['Type'] + "<" + res + ">";
        // Check the property exists
        try {
            var spec = resourcesSpec.getType(resourceType);
        }
        catch (e) {
            if (e instanceof resourcesSpec.NoSuchResourceType) {
                continue;
            }
            else {
                throw e;
            }
        }
        // Add the resource name to stack
        placeInTemplate.push(res);
        // Set the baseResourceType for PropertyType derivation
        baseResourceType = resourceType;
        // Do property validation if Properties in present
        if (resources[res].hasOwnProperty('Properties')) {
            // Add Properties to the location stack
            placeInTemplate.push('Properties');
            check({ type: 'RESOURCE', resourceType: resourceType }, resources[res]['Properties']);
            // Remove Properties
            placeInTemplate.pop();
        }
        // Remove resources
        placeInTemplate.pop();
    }
    // Remove Resource
    placeInTemplate.pop();
}
var KnownTypes;
(function (KnownTypes) {
    KnownTypes[KnownTypes["ComplexObject"] = 0] = "ComplexObject";
    KnownTypes[KnownTypes["List"] = 1] = "List";
    KnownTypes[KnownTypes["Map"] = 2] = "Map";
    KnownTypes[KnownTypes["Arn"] = 3] = "Arn";
    KnownTypes[KnownTypes["String"] = 4] = "String";
    KnownTypes[KnownTypes["Integer"] = 5] = "Integer";
    KnownTypes[KnownTypes["Boolean"] = 6] = "Boolean";
    KnownTypes[KnownTypes["Json"] = 7] = "Json";
    KnownTypes[KnownTypes["Double"] = 8] = "Double";
    KnownTypes[KnownTypes["Timestamp"] = 9] = "Timestamp";
})(KnownTypes = exports.KnownTypes || (exports.KnownTypes = {}));
function getPropertyType(objectType) {
    if (objectType.type === 'PROPERTY' && isPropertySchema(objectType)) {
        return KnownTypes.ComplexObject;
    }
    else if (objectType.type === 'PROPERTY' && isListSchema(objectType)) {
        return KnownTypes.List;
    }
    else if (objectType.type === 'PROPERTY' && isMapSchema(objectType)) {
        return KnownTypes.Map;
    }
    else if (objectType.type === 'PROPERTY' && isArnSchema(objectType)) {
        return KnownTypes.Arn;
    }
    else if (isStringSchema(objectType)) {
        return KnownTypes.String;
    }
    else if (isIntegerSchema(objectType)) {
        return KnownTypes.Integer;
    }
    else if (isBooleanSchema(objectType)) {
        return KnownTypes.Boolean;
    }
    else if (isJsonSchema(objectType)) {
        return KnownTypes.Json;
    }
    else if (isDoubleSchema(objectType)) {
        return KnownTypes.Double;
    }
    else if (isTimestampSchema(objectType)) {
        return KnownTypes.Timestamp;
    }
    else {
        // this should never happen in production; there are tests in place to ensure
        // we can determine the type of every property in the resources and propertytype specs.
        throw new Error("could not determine type of " + util.inspect(objectType));
    }
}
exports.getPropertyType = getPropertyType;
function check(objectType, objectToCheck) {
    try {
        // if we are checking against a resource or propertytype, it must be against
        // an object with subproperties.
        if ((objectType.type === 'RESOURCE') || (objectType.type === 'PROPERTY_TYPE')) {
            verify(exports.isObject, objectToCheck);
            checkComplexObject(objectType, objectToCheck);
            // otherwise, we have a named property of some resource or propertytype,
            // or just a primitive.
        }
        else {
            var propertyType = getPropertyType(objectType);
            switch (propertyType) {
                case KnownTypes.ComplexObject:
                    verify(exports.isObject, objectToCheck);
                    checkComplexObject(objectType, objectToCheck);
                    break;
                case KnownTypes.Map:
                    verify(exports.isObject, objectToCheck);
                    checkMap(objectType, objectToCheck);
                    break;
                case KnownTypes.List:
                    verify(exports.isList, objectToCheck);
                    checkList(objectType, objectToCheck);
                    break;
                case KnownTypes.Arn:
                    verify(exports.isArn, objectToCheck);
                    break;
                case KnownTypes.String:
                    verify(exports.isString, objectToCheck);
                    break;
                case KnownTypes.Integer:
                    verify(exports.isInteger, objectToCheck);
                    break;
                case KnownTypes.Boolean:
                    verify(exports.isBoolean, objectToCheck);
                    break;
                case KnownTypes.Json:
                    verify(exports.isJson, objectToCheck);
                    break;
                case KnownTypes.Double:
                    verify(exports.isDouble, objectToCheck);
                    break;
                case KnownTypes.Timestamp:
                    verify(exports.isTimestamp, objectToCheck);
                    break;
                default:
                    // this causes a typescript error if we forget to handle a KnownType.
                    var check_1 = propertyType;
            }
        }
    }
    catch (e) {
        if (e instanceof VerificationError) {
            addError('crit', e.message + (", got " + util.inspect(objectToCheck)), placeInTemplate, objectType.resourceType);
        }
        else {
            // generic error handler; let us keep checking what we can instead of crashing.
            addError('crit', "Unexpected error: " + e.message + " while checking " + util.inspect(objectToCheck) + " against " + util.inspect(objectType), placeInTemplate, objectType.resourceType);
            console.error(e);
        }
    }
}
//
// Functions to work out what types our properties are expecting.
//
function isPropertySchema(objectType) {
    if (objectType.type === 'PRIMITIVE_TYPE') {
        return false;
    }
    else {
        return !(resourcesSpec.isPrimitiveProperty(objectType.parentType, objectType.propertyName))
            && !(resourcesSpec.isPropertyTypeList(objectType.parentType, objectType.propertyName))
            && !(resourcesSpec.isPropertyTypeMap(objectType.parentType, objectType.propertyName));
    }
}
var isListSchema = function (property) {
    return resourcesSpec.isPropertyTypeList(property.parentType, property.propertyName);
};
var isMapSchema = function (property) {
    return resourcesSpec.isPropertyTypeMap(property.parentType, property.propertyName);
};
var isArnSchema = function (property) {
    return resourcesSpec.isArnProperty(property.propertyName);
};
function wrapCheck(f) {
    function wrapped(objectType) {
        var primitiveType = (objectType.type === 'PRIMITIVE_TYPE')
            ? objectType.primitiveType
            : resourcesSpec.getPrimitiveType(objectType.parentType, objectType.propertyName);
        return f(primitiveType);
    }
    return wrapped;
}
var isStringSchema = wrapCheck(function (primitiveType) { return primitiveType == 'String'; });
var isIntegerSchema = wrapCheck(function (primitiveType) { return primitiveType == 'Integer' || primitiveType == 'Long'; });
var isBooleanSchema = wrapCheck(function (primitiveType) { return primitiveType == 'Boolean'; });
var isJsonSchema = wrapCheck(function (primitiveType) { return primitiveType == 'Json'; });
var isDoubleSchema = wrapCheck(function (primitiveType) { return primitiveType == 'Double'; });
var isTimestampSchema = wrapCheck(function (primitiveType) { return primitiveType == 'Timestamp'; });
//
// Functions to verify incoming data shapes against their expected types.
//
var VerificationError = /** @class */ (function (_super) {
    __extends(VerificationError, _super);
    function VerificationError(message) {
        var _this = _super.call(this, message) || this;
        CustomError.fixErrorInheritance(_this, VerificationError);
        return _this;
    }
    return VerificationError;
}(CustomError));
function verify(verifyTypeFunction, object) {
    if (!verifyTypeFunction(object)) {
        throw new VerificationError(verifyTypeFunction.failureMessage);
    }
}
function verificationFunction(f, message) {
    return Object.assign(f, { failureMessage: message });
}
exports.isList = verificationFunction(function (o) { return (o instanceof Object && o.constructor === Array); }, 'Expecting a list');
exports.isObject = verificationFunction(function (o) { return (o instanceof Object && o.constructor === Object); }, 'Expecting an object');
exports.isString = verificationFunction(function (o) { return (typeof o === 'string') || (typeof o === 'number'); }, // wtf cfn.
'Expecting a string');
exports.isArn = verificationFunction(function (o) { return (typeof o === 'string') && o.indexOf('arn:aws') == 0; }, 'Expecting an ARN');
var integerRegex = /^-?\d+$/;
exports.isInteger = verificationFunction(function (o) {
    if (typeof o === 'number') {
        return (o === Math.round(o));
    }
    else if (typeof o === 'string') {
        return integerRegex.test(o);
    }
    else {
        return false;
    }
}, 'Expecting an integer');
var doubleRegex = /^-?\d+(.\d*)?([eE][-+]?\d+)?$/;
exports.isDouble = verificationFunction(function (o) {
    if (typeof o === 'number') {
        return !isNaN(o);
    }
    else if (typeof o === 'string') {
        return doubleRegex.test(o);
    }
    else {
        return false;
    }
}, 'Expecting a double');
exports.isBoolean = verificationFunction(function (o) {
    if (typeof o === 'boolean') {
        return true;
    }
    else if (typeof o === 'string') {
        var oLower = o.toLowerCase();
        return oLower === 'true' || oLower === 'false';
    }
    else {
        return false;
    }
}, 'Expecting a Boolean');
exports.isJson = verificationFunction(function (o) {
    if (exports.isObject(o)) {
        return true;
    }
    else if (typeof o === 'string') {
        try {
            var obj = JSON.parse(o);
            return exports.isObject(obj);
        }
        catch (e) {
            return false;
        }
    }
    else {
        return false;
    }
}, 'Expecting a JSON object');
var r = String.raw;
// adapted from https://github.com/segmentio/is-isodate (and fixed slightly)
var timestampRegex = RegExp(r(templateObject_1 || (templateObject_1 = __makeTemplateObject(["^d{4}-d{2}-d{2}"], ["^\\d{4}-\\d{2}-\\d{2}"]))) + // Match YYYY-MM-DD
 r(templateObject_2 || (templateObject_2 = __makeTemplateObject(["("], ["("]))) + // time part
 r(templateObject_3 || (templateObject_3 = __makeTemplateObject(["(Td{2}:d{2}(:d{2})?)"], ["(T\\d{2}:\\d{2}(:\\d{2})?)"]))) + // Match THH:mm:ss
 r(templateObject_4 || (templateObject_4 = __makeTemplateObject(["(.d{1,6})?"], ["(\\.\\d{1,6})?"]))) + // Match .sssss
 r(templateObject_5 || (templateObject_5 = __makeTemplateObject(["(Z|(+|-)d{2}(:?d{2}))?"], ["(Z|(\\+|-)\\d{2}(\\:?\\d{2}))?"]))) + // Time zone (Z or +hh:mm or +hhmm)
 r(templateObject_6 || (templateObject_6 = __makeTemplateObject([")?$"], [")?$"]))));
exports.isTimestamp = verificationFunction(function (o) { return (typeof o === 'string') && timestampRegex.test(o) && !isNaN(Date.parse(o)); }, 'Expecting an ISO8601-formatted string');
//
// Functions to descend into complex structures (schema'd objects, Maps, and Lists).
//
function _isKnownProperty(objectTypeName, objectType, isCustomPropertyAllowed, subPropertyName) {
    var isKnownProperty = resourcesSpec.isValidProperty(objectTypeName, subPropertyName);
    if (!isKnownProperty && !isCustomPropertyAllowed) {
        addError("crit", subPropertyName + " is not a valid property of " + objectTypeName, placeInTemplate, objectType.resourceType);
    }
    return isKnownProperty;
}
function _checkForMissingProperties(properties, objectTypeName) {
    var requiredProperties = resourcesSpec.getRequiredProperties(objectTypeName);
    // Remove the properties we have from the required property list
    var remainingProperties = requiredProperties.filter(function (propertyName) { return properties[propertyName] === undefined; });
    // If we have any items left over, they have not been defined
    if (remainingProperties.length > 0) {
        try {
            for (var remainingProperties_1 = __values(remainingProperties), remainingProperties_1_1 = remainingProperties_1.next(); !remainingProperties_1_1.done; remainingProperties_1_1 = remainingProperties_1.next()) {
                var prop = remainingProperties_1_1.value;
                addError("crit", "Required property " + prop + " missing for type " + objectTypeName, placeInTemplate, objectTypeName);
            }
        }
        catch (e_15_1) { e_15 = { error: e_15_1 }; }
        finally {
            try {
                if (remainingProperties_1_1 && !remainingProperties_1_1.done && (_a = remainingProperties_1.return)) _a.call(remainingProperties_1);
            }
            finally { if (e_15) throw e_15.error; }
        }
    }
    var e_15, _a;
}
function localizeType(type) {
    // determine localized name
    var typePlaceInTemplate = clone(placeInTemplate);
    typePlaceInTemplate.splice(0, 1); // remove 'Resources'
    typePlaceInTemplate.splice(1, 1); // remove 'Properties'
    typePlaceInTemplate = typePlaceInTemplate.join('#');
    // don't localize primitive, complex or already localized types
    var localType = type;
    if (!resourcesSpec.isPrimitiveType(type) &&
        !resourcesSpec.isAggregateType(type) &&
        !resourcesSpec.isParameterizedTypeFormat(type)) {
        localType = type + "<" + typePlaceInTemplate + ">";
    }
    return localType;
}
function checkComplexObject(objectType, objectToCheck) {
    var objectTypeName = getTypeName(objectType);
    if (!objectTypeName) {
        var namedProperty = objectType;
        throw new Error(namedProperty.parentType + "." + namedProperty.propertyName + " is not a ResourceType or PropertyType, but we tried to get its type anyway.");
    }
    objectTypeName = localizeType(objectTypeName);
    // Check for missing required properties
    _checkForMissingProperties(objectToCheck, objectTypeName);
    var isCustomPropertyAllowed = resourcesSpec.isAdditionalPropertiesEnabled(objectTypeName);
    for (var subPropertyName in objectToCheck) {
        placeInTemplate.push(subPropertyName);
        var propertyValue = objectToCheck[subPropertyName];
        try {
            // check if property is recognized
            if (!_isKnownProperty(objectTypeName, objectType, isCustomPropertyAllowed, subPropertyName)) {
                continue;
            }
            // already handled in check for missing properties, above.
            if (propertyValue === undefined) {
                continue;
            }
            var subPropertyObjectType = {
                type: 'PROPERTY',
                resourceType: objectType.resourceType,
                parentType: objectTypeName,
                propertyName: subPropertyName
            };
            check(subPropertyObjectType, propertyValue);
        }
        finally {
            placeInTemplate.pop();
        }
    }
    // TODO How to handle optional required parameters
}
function checkList(objectType, listToCheck) {
    try {
        for (var _a = __values(listToCheck.entries()), _b = _a.next(); !_b.done; _b = _a.next()) {
            var _c = __read(_b.value, 2), index = _c[0], item = _c[1];
            placeInTemplate.push(index);
            if (!util.isUndefined(item)) {
                var itemType = getItemType(objectType);
                if (itemType.type == 'PROPERTY_TYPE') {
                    itemType.propertyType = localizeType(itemType.propertyType);
                }
                check(itemType, item);
            }
            placeInTemplate.pop();
        }
    }
    catch (e_16_1) { e_16 = { error: e_16_1 }; }
    finally {
        try {
            if (_b && !_b.done && (_d = _a.return)) _d.call(_a);
        }
        finally { if (e_16) throw e_16.error; }
    }
    var e_16, _d;
}
function checkMap(objectType, mapToCheck) {
    for (var key in mapToCheck) {
        placeInTemplate.push(key);
        var item = mapToCheck[key];
        var itemType = getItemType(objectType);
        if (itemType.type == 'PROPERTY_TYPE') {
            itemType.propertyType = localizeType(itemType.propertyType);
        }
        check(itemType, item);
        placeInTemplate.pop();
    }
}
// EXPOSE INTERNAL FUNCTIONS FOR TESTING PURPOSES
exports.__TESTING__ = {
    'resourcesSpec': resourcesSpec,
    'inferPrimitiveValueType': inferPrimitiveValueType,
    'inferStructureValueType': inferStructureValueType,
    'inferAggregateValueType': inferAggregateValueType,
    'inferValueType': inferValueType,
    'templateHasUnresolvedIntrinsics': templateHasUnresolvedIntrinsics
};
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5, templateObject_6;
//# sourceMappingURL=validator.js.map