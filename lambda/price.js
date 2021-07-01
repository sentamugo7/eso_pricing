const Alexa = require('ask-sdk-core');
const constants = require('./constants');
const util = require('./util');
const axios = require('axios');
const https = require('https');
const AdmZip = require('adm-zip');

function roundDollar(amount){
    return (Math.round(100 * parseFloat(amount)) / 100.0).toString();
}

function priceCheck(handlerInput, ttcRegion, langCode, itemName, quality, level, trait) {
    var ttcItemLookupTable = constants.TTC_ITEM_LOOKUP[langCode];
    const file_url = constants.TTC_PRICE_CHECK_URL[ttcRegion];

    async function getPriceCheckResponse(url){
        const res = await axios.get(url,{responseType: 'arraybuffer',maxContentLength: 6000000,});
        return res.data;
    }
    return getPriceCheckResponse(file_url).then((result) => {
        var zip = new AdmZip(result);
        var zipEntries = zip.getEntries();
        let ttcItemLookup = null;
        let ttcPrice = null;
        let priceCheck = null;
        let itemLookupFound = false;
        let priceFound = false;
        zipEntries.forEach((entry) => {
            if (entry.entryName === ttcItemLookupTable) {
                ttcItemLookup = entry.getData().toString('utf8');
                itemLookupFound = true;
            }
            if (entry.entryName === constants.TTC_PRICE_CHECK) {
                ttcPrice = entry.getData().toString('utf8');
                priceFound = true;
            }
        });
        if (itemLookupFound && priceFound) {
            var searchItemRegexp = constants.TTC_ITEM_SEARCH_REGEX.replace('{{itemName}}',itemName);

            var matchItem = new RegExp(searchItemRegexp).exec(ttcItemLookup);
            if (!matchItem || matchItem.length <= 1) {
                priceCheck = null;
            } else {
                let itemCode = matchItem[2];
                var searchPriceRegexp = constants.TTC_PRICE_SEARCH_REGEX.replace('{{itemCode}}',itemCode);
                var matchPrice = new RegExp(searchPriceRegexp).exec(ttcPrice);
                if (!matchPrice || matchPrice.length <= 1) {
                    priceCheck = 'error';
                } else {
                    var priceStr = matchPrice[1].replace(/\[/g,'').replace(/\]/g,'').replace(/=/g,':').replace(/,\}/g,'}').replace(/\{/g,'{"').replace(/:\{/g,'":{').replace(/""/g,'"').replace(/\},/g,'},"');
                    var priceObj = JSON.parse(priceStr);

                    let foundQualityId = [];
                    let foundLevelId = [];
                    let foundTraitId = [];

                    let recipeIdsForIngredients = [];
                    let priceDetail = null;
                    for (const [qualityId, qualityObj] of Object.entries(priceObj)) {
                        if (quality === null || quality === parseInt(qualityId)) {
                            for (const [levelId, levelObj] of Object.entries(qualityObj)) {
                                if (level === null || level === parseInt(levelId)) {
                                    for (const [traitId, traitObj] of Object.entries(levelObj)) {
                                        if (trait === null || trait === parseInt(traitId)) {
                                            priceDetail = {obj:traitObj,qualityId:qualityId,levelId:levelId,traitId:traitId};
                                            if (foundQualityId.indexOf(qualityId) === -1) {
                                                foundQualityId.push(qualityId);
                                            }
                                            if (foundLevelId.indexOf(levelId) === -1) {
                                                foundLevelId.push(levelId);
                                            }
                                            if (foundTraitId.indexOf(traitId) === -1) {
                                                foundTraitId.push(traitId);
                                            }
                                        }

                                    }
                                }
                            }
                        }
                    }
                    if (priceDetail !== null) {
                        let suggested = (priceDetail.obj.SuggestedPrice === undefined) ? null : roundDollar(parseFloat(priceDetail.obj.SuggestedPrice));
                        let suggestedUpper = (suggested === null) ? null : roundDollar(suggested * constants.TTC_SUGGESTED_MULT);
                        priceCheck = {item:itemName,min:priceDetail.obj.Min,avg:priceDetail.obj.Avg,max:priceDetail.obj.Max,suggested:suggested,suggestedUpper:suggestedUpper,amountCount:priceDetail.obj.AmountCount,entryCount:priceDetail.obj.EntryCount,qualityId:priceDetail.qualityId,levelId:priceDetail.levelId,traitId:priceDetail.traitId,foundQualityId:foundQualityId,foundLevelId:foundLevelId,foundTraitId:foundTraitId};
                    }
                }
            }
        }
        return priceCheck;
    }).catch((error) => {
        return 'error';
    });
}

const PriceCheckIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'PriceCheckIntent' || Alexa.getIntentName(handlerInput.requestEnvelope) === 'FullPriceCheckIntent');
    },
    async handle(handlerInput) {
        const {attributesManager, requestEnvelope} = handlerInput;
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        let conjunction = handlerInput.t('CONJUNCTION_MSG');
        let qualifier = handlerInput.t('QUALIFIER_MSG');
        let speechText = null;

        const itemSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'item');
        let itemId = -1;
        const itemName = itemSlot.value;
        if (itemSlot && itemSlot.value) {
            itemId = constants.GET_ID(itemSlot);
            if (itemId === -1) {
                speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_ITEM'),entry:itemName});
                return constants.FINISH(handlerInput, speechText);
            }
        } else {
            speechText = handlerInput.t('NO_CATEGORY',{category:handlerInput.t('CATEGORY_ITEM'),entry:itemSlot.value});
            return constants.FINISH(handlerInput, speechText);
        }
        speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_ITEM'),entry:itemName});
        let resultText = (Alexa.getIntentName(handlerInput.requestEnvelope) === 'FullPriceCheckIntent') ? 'FULL_PRICE_CHECK_RESULT' : 'PRICE_CHECK_RESULT';

        const qualitySlot = Alexa.getSlot(handlerInput.requestEnvelope, 'quality');
        let quality = null;
        if (qualitySlot && qualitySlot.value) {
            quality = constants.GET_ID(qualitySlot);
            if (quality === -1) {
                speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_QUALITY'),entry:qualitySlot.value});
                return constants.FINISH(handlerInput, speechText);
            }
        }
        const levelSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'level');
        let level = null;
        if (levelSlot && levelSlot.value) {
            level = constants.GET_ID(levelSlot);
            if (level === -1) {
                speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_LEVEL'),entry:levelSlot.value});
                return constants.FINISH(handlerInput, speechText);
            }
        }
        const traitSlot = Alexa.getSlot(handlerInput.requestEnvelope, 'trait');
        let trait = null;
        if (traitSlot && traitSlot.value) {
            trait = constants.GET_ID(traitSlot);
            if (trait === -1) {
                speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_TRAIT'),entry:traitSlot.value});
                return constants.FINISH(handlerInput, speechText);
            }
        }

        const regionSlot = Alexa.getSlot(requestEnvelope, 'region');
        let region = null;
        if (regionSlot && regionSlot.value) {
            region = constants.GET_ID(regionSlot);
            if (region === -1) {
                speechText = handlerInput.t('CATEGORY_ENTRY_NOT_FOUND',{category:handlerInput.t('CATEGORY_REGION'),entry:regionSlot.value});
                return constants.FINISH(handlerInput, speechText);
            }
        }

        try {
            // call the progressive response service
            await util.callDirectiveService(handlerInput, handlerInput.t('PROGRESSIVE_PRICE_MSG', {item:itemName}));
        } catch (error) {
            // if it fails we can continue, but the user will wait without progressive response
            console.log("Progressive price response directive error : " + error);
        }
        const regionId = (region === null) ? constants.DEFAULT_REGION_ID : region;
        const ttcRegion = constants.TTC_REGIONS[parseInt(regionId)];
        sessionAttributes['priceCheckIntentType'] = Alexa.getIntentName(handlerInput.requestEnvelope);
        sessionAttributes['priceCheckItemName'] = itemName;
        let langCode = handlerInput.requestEnvelope.request.locale.substr(0,2);
        let response = await priceCheck(handlerInput, ttcRegion, langCode, itemName, quality, level, trait);
        let qualifiedItem = itemName;
        let connector = qualifier;
        if (quality !== null) {
            qualifiedItem += " " + connector + " " + handlerInput.t('CATEGORY_QUALITY') + " " + qualitySlot.value;
            connector = conjunction;
        }
        if (level !== null) {
            qualifiedItem += " " + connector + " " + handlerInput.t('CATEGORY_LEVEL') + " " + levelSlot.value;
            connector = conjunction;
        }
        if (trait !== null) {
            qualifiedItem += " " + connector + " " + handlerInput.t('CATEGORY_TRAIT') + " " + traitSlot.value;
        }
        if (region !== null) {
            qualifiedItem += " " + connector + " " + handlerInput.t('CATEGORY_REGION') + " " + regionSlot.value;
        }
        if (response === 'error') {
            speechText = handlerInput.t('ERROR_MSG');
        } else if (response === null) {
            speechText = handlerInput.t('PRICE_CHECK_NONE_FOUND',{qualifiedItem:qualifiedItem});
        } else {
            console.log('PriceCheckIntentHandler', '#5');
            let qualifiers = "";
            let multsArray = [];
            let mults = null;
            if (response.foundQualityId.length > 1) {
                multsArray.push(handlerInput.t('CATEGORY_QUALITY'));
            }
            if (response.foundLevelId.length > 1) {
                multsArray.push(handlerInput.t('CATEGORY_LEVEL'));
            }
            if (response.foundTraitId.length > 1) {
                multsArray.push(handlerInput.t('CATEGORY_TRAIT'));
            }
            if (multsArray.length > 0) {
                mults = multsArray.join(' ' + conjunction + ' ');
            }
            response.mults = mults;
            if (mults === null) {
                response.quality = handlerInput.t('EQUIPMENT_QUALITY_' + response.qualityId);
                response.level = (response.levelId > 50) ? "c.p. " + (response.levelId - 50) : "" + response.levelId;
                response.trait = handlerInput.t('TRAIT_' + ((response.traitId === "-1") ? "" : response.traitId));
                response.qualifiedItem = qualifiedItem;
                if (response.suggested === null) {
                    if (resultText === 'PRICE_CHECK_RESULT') {
                        resultText = 'PRICE_CHECK_NO_SUGGESTED_RESULT';
                    } else {
                        resultText = 'FULL_PRICE_CHECK_NO_SUGGESTED_RESULT';
                    }
                }
            } else {
                resultText = 'PRICE_CHECK_MULTS_RESULT';
            }
            speechText = handlerInput.t(resultText, response);
        }
        return constants.FINISH(handlerInput, speechText);
    }
};

module.exports = {
    PriceCheckIntentHandler:PriceCheckIntentHandler
}
