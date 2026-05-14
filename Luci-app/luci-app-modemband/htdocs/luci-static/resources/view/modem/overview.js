'use strict';
'require view';
'require fs';
'require uci';
'require poll';
'require dom';

var MMCLI_BIN = '/usr/bin/mmcli';
var MODEMBAND_BIN = '/usr/bin/modemband.sh';
var SMS_TOOL_BIN = '/usr/bin/sms_tool';

var AT_COMMANDS = {
	csq: 'AT+CSQ',
	cops: 'AT+COPS?',
	qnwinfo: 'AT+QNWINFO',
	qtemp: 'AT+QTEMP?',
	cbc: 'AT+CBC',
	qeng: 'AT+QENG="servingcell"'
};

var PLMN_OPERATOR_MAP = {
	'46000': 'China Mobile',
	'46002': 'China Mobile',
	'46004': 'China Mobile',
	'46007': 'China Mobile',
	'46008': 'China Mobile',
	'46001': 'China Unicom',
	'46006': 'China Unicom',
	'46009': 'China Unicom',
	'46003': 'China Telecom',
	'46005': 'China Telecom',
	'46011': 'China Telecom',
	'46015': 'China Broadnet'
};

function parseJson(data) {
	try {
		return JSON.parse(data || '{}');
	}
	catch (err) {
		return null;
	}
}

function normalizeValue(value) {
	if (value == null)
		return null;

	if (typeof(value) == 'string') {
		value = value.trim();
		if (value === '' || value === '--')
			return null;
	}

	return value;
}

function normalizeDeep(value) {
	var key;

	if (value == null)
		return null;

	if (Array.isArray(value))
		return value.map(normalizeDeep);

	if (typeof(value) == 'object') {
		for (key in value)
			value[key] = normalizeDeep(value[key]);

		return value;
	}

	return normalizeValue(value);
}

function execText(path, args) {
	return L.resolveDefault(fs.exec_direct(path, args), '').then(function(output) {
		return String(output || '').replace(/\r/g, '');
	});
}

function execJson(path, args) {
	return execText(path, args).then(function(output) {
		var json = parseJson(output);

		return normalizeDeep(json);
	});
}

function parseIndex(dbusPath) {
	var parts;

	if (!dbusPath)
		return null;

	parts = String(dbusPath).split('/');
	return parts.length ? parts[parts.length - 1] : null;
}

function normalizePort(port) {
	port = normalizeValue(port);

	if (!port)
		return null;

	if (String(port).indexOf('/dev/') === 0)
		return String(port);

	return '/dev/' + String(port);
}

function joinList(values) {
	values = Array.isArray(values) ? values.filter(function(item) {
		return normalizeValue(item) != null;
	}) : [];

	return values.length ? values.join(', ') : null;
}

function formatBandList(values, prefix) {
	values = Array.isArray(values) ? values : [];

	if (!values.length)
		return null;

	return values.map(function(value) {
		return prefix + String(value).replace(/[^0-9]/g, '');
	}).join(' ');
}

function formatMetric(value, suffix) {
	if (value == null || value === '')
		return null;

	return String(value) + (suffix || '');
}

function parseInteger(value) {
	var parsed = parseInt(value, 10);

	return isNaN(parsed) ? null : parsed;
}

function parseCSQ(output) {
	var match = output.match(/\+CSQ:\s*(\d+),(\d+)/);
	var value;

	if (!match)
		return null;

	value = parseInteger(match[1]);
	if (value == null || value === 99)
		return { value: value, percent: null, dbm: null };

	return {
		value: value,
		percent: Math.round((value / 31) * 100),
		dbm: -113 + (value * 2)
	};
}

function parseCBC(output) {
	var match = output.match(/\+CBC:\s*(\d+),(\d+),(\d+)/);
	var millivolts;

	if (!match)
		return null;

	millivolts = parseInteger(match[3]);

	return millivolts == null ? null : {
		millivolts: millivolts,
		volts: (millivolts / 1000).toFixed(2)
	};
}

function parseQNWINFO(output) {
	var match;

	if (!output)
		return null;

	if (/No Service/i.test(output))
		return { network: _('No Service') };

	match = output.match(/\+QNWINFO:\s*"([^"]+)","([^"]+)","([^"]+)"(?:,(\d+))?/);
	if (!match)
		return null;

	return {
		network: normalizeValue(match[1]),
		plmn: normalizeValue(match[2]),
		band: normalizeValue(match[3]),
		channel: normalizeValue(match[4])
	};
}

function parseTemperature(output) {
	var matches = output.match(/-?\d+/g);
	var values;

	if (!matches || !matches.length)
		return null;

	values = matches.map(function(value) {
		return parseInteger(value);
	}).filter(function(value) {
		return value != null && value > -80 && value < 200;
	});

	return values.length ? { celsius: values[0], values: values } : null;
}

function parseCsvLine(text) {
	var tokens = [];
	var match;
	var line = text.split('\n').filter(function(item) {
		return item.indexOf('+QENG:') > -1;
	})[0];
	var body;
	var regex;

	if (!line)
		return null;

	body = line.replace(/^.*\+QENG:\s*/, '');
	regex = /"([^"]*)"|([^,]+)/g;

	while ((match = regex.exec(body)) !== null)
		tokens.push((match[1] != null ? match[1] : match[2]).trim());

	return tokens;
}

function parseQENG(output) {
	var tokens = parseCsvLine(output);
	var data = {};

	if (!tokens || !tokens.length)
		return null;

	if (tokens[0] !== 'servingcell')
		return { raw: tokens.join(', ') };

	data.state = normalizeValue(tokens[1]);
	data.mode = normalizeValue(tokens[2]);
	data.duplex = normalizeValue(tokens[3]);
	data.mcc = normalizeValue(tokens[4]);
	data.mnc = normalizeValue(tokens[5]);

	if (data.mode === 'NR5G-SA' && tokens.length >= 17) {
		data.cellId = normalizeValue(tokens[6]);
		data.pci = normalizeValue(tokens[7]);
		data.tac = normalizeValue(tokens[8]);
		data.arfcn = normalizeValue(tokens[9]);
		data.band = normalizeValue(tokens[10]);
		data.bandwidth = normalizeValue(tokens[11]);
		data.rsrp = parseInteger(tokens[12]);
		data.rsrq = parseInteger(tokens[13]);
		data.sinr = parseInteger(tokens[14]);
	}
	else {
		data.band = normalizeValue(tokens[10]);
	}

	return data;
}

function lookupOperatorName(code) {
	code = normalizeValue(code);

	if (!code || !PLMN_OPERATOR_MAP[String(code)])
		return null;

	return _(PLMN_OPERATOR_MAP[String(code)]);
}

function percentFromRSRP(rsrp) {
	if (rsrp == null)
		return null;

	return Math.max(0, Math.min(100, Math.round(((rsrp + 140) / 70) * 100)));
}

function getSignalPercent(mmInfo, atInfo) {
	if (atInfo && atInfo.qeng && atInfo.qeng.rsrp != null)
		return percentFromRSRP(atInfo.qeng.rsrp);

	if (mmInfo && mmInfo.signalQuality != null)
		return mmInfo.signalQuality;

	if (atInfo && atInfo.csq && atInfo.csq.percent != null)
		return atInfo.csq.percent;

	return null;
}

function getSignalBars(percent) {
	if (percent == null)
		return 0;

	if (percent >= 80)
		return 4;
	if (percent >= 55)
		return 3;
	if (percent >= 30)
		return 2;
	if (percent >= 10)
		return 1;

	return 0;
}

function getMmInfo(mmState) {
	var modem = mmState && mmState.modem && mmState.modem.modem ? mmState.modem.modem : {};
	var generic = modem.generic || {};
	var modem3gpp = modem['3gpp'] || {};
	var location = mmState && mmState.location && mmState.location.modem && mmState.location.modem.location ? mmState.location.modem.location['3gpp'] || {} : {};

	return {
		manufacturer: normalizeValue(generic.manufacturer),
		model: normalizeValue(generic.model),
		revision: normalizeValue(generic.revision),
		imei: normalizeValue(modem3gpp.imei || generic['equipment-identifier']),
		deviceIdentifier: normalizeValue(generic['device-identifier']),
		powerState: normalizeValue(generic['power-state']),
		state: normalizeValue(generic.state),
		failReason: normalizeValue(generic['state-failed-reason']),
		accessTechnologies: joinList(generic['access-technologies']),
		currentCapabilities: joinList(generic['current-capabilities']),
		signalQuality: parseInteger(generic['signal-quality'] && generic['signal-quality'].value),
		operatorName: normalizeValue(modem3gpp['operator-name']),
		operatorCode: normalizeValue(modem3gpp['operator-code']),
		registrationState: normalizeValue(modem3gpp['registration-state']),
		packetServiceState: normalizeValue(modem3gpp['packet-service-state']),
		primaryPort: normalizePort(generic['primary-port']),
		location: {
			cid: normalizeValue(location.cid),
			lac: normalizeValue(location.lac),
			mcc: normalizeValue(location.mcc),
			mnc: normalizeValue(location.mnc),
			tac: normalizeValue(location.tac)
		}
	};
}

function formatRegion(mmInfo, atInfo) {
	var parts = [];
	var mcc = mmInfo.location && mmInfo.location.mcc ? mmInfo.location.mcc : atInfo && atInfo.qeng ? atInfo.qeng.mcc : null;
	var mnc = mmInfo.location && mmInfo.location.mnc ? mmInfo.location.mnc : atInfo && atInfo.qeng ? atInfo.qeng.mnc : null;
	var tac = mmInfo.location && mmInfo.location.tac ? mmInfo.location.tac : atInfo && atInfo.qeng ? atInfo.qeng.tac : null;
	var cid = mmInfo.location && mmInfo.location.cid ? mmInfo.location.cid : atInfo && atInfo.qeng ? atInfo.qeng.cellId : null;

	if (mcc || mnc)
		parts.push('MCC/MNC ' + [ mcc, mnc ].filter(Boolean).join('/'));
	if (tac)
		parts.push('TAC ' + tac);
	if (cid)
		parts.push('CID ' + cid);

	return parts.length ? parts.join(' · ') : null;
}

function formatOperator(mmInfo, atInfo) {
	var operatorCode = mmInfo.operatorCode || (atInfo && atInfo.qnwinfo ? atInfo.qnwinfo.plmn : null) || ((atInfo && atInfo.qeng && atInfo.qeng.mcc && atInfo.qeng.mnc) ? String(atInfo.qeng.mcc) + String(atInfo.qeng.mnc) : null);
	var operatorName = mmInfo.operatorName || lookupOperatorName(operatorCode);
	var details = [];

	if (operatorName)
		details.push(operatorName);
	if (operatorCode)
		details.push(operatorCode);

	return details.length ? details.join(' · ') : null;
}

function formatAccess(mmInfo, atInfo) {
	var parts = [];

	if (atInfo && atInfo.qeng && atInfo.qeng.mode)
		parts.push(atInfo.qeng.mode + (atInfo.qeng.duplex ? ' / ' + atInfo.qeng.duplex : ''));
	else if (atInfo && atInfo.qnwinfo && atInfo.qnwinfo.network)
		parts.push(atInfo.qnwinfo.network);
	else if (mmInfo.accessTechnologies)
		parts.push(mmInfo.accessTechnologies);

	if (mmInfo.registrationState)
		parts.push(mmInfo.registrationState);

	return parts.length ? parts.join(' · ') : null;
}

function formatServingBand(atInfo) {
	if (atInfo && atInfo.qeng && atInfo.qeng.band)
		return (atInfo.qeng.mode && atInfo.qeng.mode.indexOf('NR5G') > -1 ? 'n' : 'B') + atInfo.qeng.band;

	if (atInfo && atInfo.qnwinfo && atInfo.qnwinfo.band)
		return atInfo.qnwinfo.band;

	return null;
}

function formatSignalDetails(mmInfo, atInfo) {
	var parts = [];

	if (atInfo && atInfo.qeng && atInfo.qeng.rsrp != null)
		parts.push('RSRP ' + atInfo.qeng.rsrp + ' dBm');
	if (atInfo && atInfo.qeng && atInfo.qeng.rsrq != null)
		parts.push('RSRQ ' + atInfo.qeng.rsrq + ' dB');
	if (atInfo && atInfo.qeng && atInfo.qeng.sinr != null)
		parts.push('SINR ' + atInfo.qeng.sinr + ' dB');
	if (!parts.length && atInfo && atInfo.csq && atInfo.csq.dbm != null)
		parts.push('RSSI ' + atInfo.csq.dbm + ' dBm');
	if (!parts.length && mmInfo.signalQuality != null)
		parts.push(_('Signal Quality') + ' ' + mmInfo.signalQuality + '%');

	return parts.length ? parts.join(' · ') : null;
}

function getModuleBadge(mmInfo, atInfo, bands) {
	if (atInfo && atInfo.qeng && atInfo.qeng.mode && atInfo.qeng.mode.indexOf('NR5G') > -1)
		return '5G';
	if (bands && Array.isArray(bands.enabled5gsa) && bands.enabled5gsa.length)
		return '5G';
	if (bands && Array.isArray(bands.enabled5gnsa) && bands.enabled5gnsa.length)
		return '5G';
	if (mmInfo.currentCapabilities && mmInfo.currentCapabilities.indexOf('lte') > -1)
		return '4G';

	return 'WWAN';
}

function getTemperatureText(atInfo) {
	if (atInfo && atInfo.qtemp && atInfo.qtemp.celsius != null)
		return atInfo.qtemp.celsius + ' °C';

	return _('Unavailable from current backend');
}

function getVoltageText(atInfo) {
	if (atInfo && atInfo.cbc && atInfo.cbc.volts)
		return atInfo.cbc.volts + ' V';

	return _('Unavailable from current backend');
}

function displayValue(value) {
	return (value != null && value !== '') ? value : '--';
}

function formatModuleName(mmInfo, bands) {
	var manufacturer = normalizeValue(mmInfo.manufacturer);
	var model = normalizeValue(mmInfo.model) || normalizeValue(bands.modem);

	if (manufacturer && model && String(model).toLowerCase().indexOf(String(manufacturer).toLowerCase()) === 0)
		return model;

	if (manufacturer || model)
		return [ manufacturer, model ].filter(Boolean).join(' ');

	return _('Unknown');
}

function getBandTokens(values, prefix) {
	values = Array.isArray(values) ? values : [];

	if (!values.length)
		return [];

	values = values.map(function(value) {
		return prefix + String(value).replace(/[^0-9]/g, '');
	});

	if (values.indexOf(prefix + '0') > -1)
		return [ _('Bands are disabled...') ];

	return values;
}

function getBandFamilies(bands) {
	var families = [];

	if (getBandTokens(bands.enabled, 'B').length)
		families.push('LTE');
	if (getBandTokens(bands.enabled5gsa, 'n').length)
		families.push('5G SA');
	if (getBandTokens(bands.enabled5gnsa, 'n').length)
		families.push('5G NSA');

	return families;
}

function renderTag(text, extraClass) {
	if (text == null || text === '')
		return null;

	return E('span', { 'class': 'mb-status-chip ' + (extraClass || '') }, String(text));
}

function renderDetailRows(items) {
	items = (items || []).filter(function(item) {
		return item[1] != null && item[1] !== '';
	});

	if (!items.length)
		return null;

	return E('div', { 'class': 'mb-detail-rows' }, items.map(function(item) {
		return E('div', { 'class': 'mb-detail-row' }, [
			E('span', { 'class': 'mb-detail-label' }, item[0]),
			E('strong', { 'class': 'mb-detail-value' }, displayValue(item[1]))
		]);
	}));
}

function renderMetricCard(title, value, detail, extraClass, icon) {
	return E('div', { 'class': 'mb-overview-card ' + (extraClass || '') }, [
		E('div', { 'class': 'mb-overview-card-title' }, [
			icon ? E('span', { 'class': 'mb-overview-card-icon' }, icon) : null,
			E('span', {}, title)
		]),
		E('div', { 'class': 'mb-overview-card-value' }, displayValue(value)),
		detail ? E('div', { 'class': 'mb-overview-card-detail' }, detail) : null
	]);
}

function renderSpotlightCard(title, value, subtitle, extraClass, tags, details) {
	tags = (tags || []).filter(function(tag) {
		return tag != null && tag !== '';
	});

	return E('div', { 'class': 'mb-spotlight-card ' + (extraClass || '') }, [
		E('div', { 'class': 'mb-spotlight-title' }, title),
		E('div', { 'class': 'mb-spotlight-value' }, displayValue(value)),
		subtitle ? E('div', { 'class': 'mb-spotlight-subtitle' }, subtitle) : null,
		tags.length ? E('div', { 'class': 'mb-chip-list' }, tags.map(function(tag) {
			return renderTag(tag);
		})) : null,
		renderDetailRows(details)
	]);
}

function renderModuleHero(mmInfo, atInfo, bands, signalPercent) {
	var badge = getModuleBadge(mmInfo, atInfo, bands);
	var bars = getSignalBars(signalPercent);
	var barsNode = [];
	var i;

	for (i = 0; i < 4; i++) {
		barsNode.push(E('span', {
			'class': 'mb-signal-bar' + (i < bars ? ' is-active' : ''),
			'style': 'height:' + String(6 + (i * 4)) + 'px'
		}));
	}

	return E('div', { 'class': 'mb-hero-card' }, [
		E('div', { 'class': 'mb-hero-icon' }, [
			E('div', { 'class': 'mb-device-glyph' }, [ E('span', { 'class': 'mb-device-chip' }, badge) ]),
			E('div', { 'class': 'mb-device-signal' }, barsNode)
		]),
		E('div', { 'class': 'mb-hero-copy' }, [
			E('div', { 'class': 'mb-hero-kicker' }, _('Modem Overview')),
			E('div', { 'class': 'mb-hero-title' }, formatModuleName(mmInfo, bands)),
			E('div', { 'class': 'mb-hero-subtitle' }, [
				E('span', { 'class': 'mb-pill' }, badge),
				mmInfo.state ? E('span', { 'class': 'mb-pill' }, mmInfo.state) : null,
				mmInfo.powerState ? E('span', { 'class': 'mb-pill' }, mmInfo.powerState) : null
			]),
			E('div', { 'class': 'mb-hero-meta' }, _('Runtime data source: ModemManager (mmcli); band data source: modemband.'))
		])
	]);
}

function renderInfoTable(rows) {
	return E('table', { 'class': 'table' }, rows.filter(function(row) {
		return row[1] != null;
	}).map(function(row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '32%' }, row[0]),
			E('td', { 'class': 'td left' }, row[1])
		]);
	}));
}

function renderBandGroup(title, values, prefix) {
	var tokens = getBandTokens(values, prefix);

	return E('div', { 'class': 'mb-band-group' }, [
		E('div', { 'class': 'mb-band-group-title' }, title),
		E('div', { 'class': 'mb-band-chip-list' }, (tokens.length ? tokens : [ '--' ]).map(function(token) {
			return renderTag(token, token === '--' ? 'is-placeholder' : 'is-band');
		}))
	]);
}

function renderBandSection(bands, servingBand, accessInfo) {
	var families = getBandFamilies(bands);

	return E('div', { 'class': 'mb-spotlight-card is-bands' }, [
		E('div', { 'class': 'mb-spotlight-title' }, _('Selected Bands')),
		E('div', { 'class': 'mb-band-focus' }, [
			E('div', { 'class': 'mb-band-focus-label' }, _('Serving Band')),
			E('div', { 'class': 'mb-band-focus-value' }, displayValue(servingBand)),
			accessInfo ? E('div', { 'class': 'mb-band-focus-detail' }, accessInfo) : null
		]),
		families.length ? E('div', { 'class': 'mb-chip-list' }, families.map(function(family) {
			return renderTag(family, 'is-family');
		})) : null,
		E('div', { 'class': 'mb-band-grid' }, [
			renderBandGroup(_('LTE Selected Bands'), bands.enabled, 'B'),
			renderBandGroup(_('5G SA Selected Bands'), bands.enabled5gsa, 'n'),
			renderBandGroup(_('5G NSA Selected Bands'), bands.enabled5gnsa, 'n')
		])
	]);
}

function renderOverview(state) {
	var bands = state.bands || {};
	var mmInfo = state.mmInfo || {};
	var atInfo = state.atInfo || {};
	var signalPercent = getSignalPercent(mmInfo, atInfo);
	var registration = mmInfo.registrationState || (atInfo.qnwinfo && atInfo.qnwinfo.network) || _('No active network information is currently available.');
	var operatorInfo = formatOperator(mmInfo, atInfo) || _('Unavailable from current backend');
	var regionInfo = formatRegion(mmInfo, atInfo) || _('Unavailable from current backend');
	var signalDetail = formatSignalDetails(mmInfo, atInfo) || _('No active network information is currently available.');
	var signalValue = signalPercent != null ? (signalPercent + '%') : '--';
	var accessInfo = formatAccess(mmInfo, atInfo) || _('Unavailable from current backend');
	var servingBand = formatServingBand(atInfo) || null;
	var operatorCode = mmInfo.operatorCode || (atInfo.qnwinfo && atInfo.qnwinfo.plmn) || null;
	var cellIdentity = atInfo.qeng && atInfo.qeng.cellId ? ('CID ' + atInfo.qeng.cellId) : null;

	return E('div', { 'class': 'mb-overview-root' }, [
		renderModuleHero(mmInfo, atInfo, bands, signalPercent),
		!state.mmAvailable ? E('div', { 'class': 'alert-message warning' }, _('No runtime modem data is available. Install and start ModemManager to show live status.')) : null,
		E('div', { 'class': 'mb-spotlight-grid' }, [
			renderSpotlightCard(_('Operator Information'), operatorInfo, registration, 'is-operator', [
				operatorCode,
				atInfo.qnwinfo && atInfo.qnwinfo.network ? atInfo.qnwinfo.network : null
			], [
				[ _('Access Technology'), accessInfo ],
				[ _('Region'), regionInfo ],
				[ 'PLMN', operatorCode ]
			]),
			renderSpotlightCard(_('Current Cell'), servingBand || cellIdentity || '--', signalDetail, 'is-cell', [
				atInfo.qeng && atInfo.qeng.mode ? atInfo.qeng.mode : null,
				atInfo.qeng && atInfo.qeng.duplex ? atInfo.qeng.duplex : null,
				atInfo.qeng && atInfo.qeng.bandwidth ? formatMetric(atInfo.qeng.bandwidth, ' MHz') : null
			], [
				[ 'PCI', atInfo.qeng && atInfo.qeng.pci ? atInfo.qeng.pci : null ],
				[ 'ARFCN', atInfo.qeng && atInfo.qeng.arfcn ? atInfo.qeng.arfcn : null ],
				[ 'TAC', atInfo.qeng && atInfo.qeng.tac ? atInfo.qeng.tac : mmInfo.location && mmInfo.location.tac ? mmInfo.location.tac : null ],
				[ 'CID', atInfo.qeng && atInfo.qeng.cellId ? atInfo.qeng.cellId : mmInfo.location && mmInfo.location.cid ? mmInfo.location.cid : null ]
			]),
			renderBandSection(bands, servingBand, accessInfo)
		]),
		E('div', { 'class': 'mb-overview-grid' }, [
			renderMetricCard(_('Signal Strength'), signalValue, signalDetail, 'is-signal', [
				E('span', { 'class': 'mb-mini-bars' }, [
					E('span', { 'class': 'mb-mini-bar' }),
					E('span', { 'class': 'mb-mini-bar' }),
					E('span', { 'class': 'mb-mini-bar' }),
					E('span', { 'class': 'mb-mini-bar' })
				])
			]),
			renderMetricCard(_('Module Temperature'), getTemperatureText(atInfo), atInfo.qtemp && atInfo.qtemp.values && atInfo.qtemp.values.length > 1 ? (atInfo.qtemp.values.join(' / ') + ' °C') : null, 'is-thermal', 'T'),
			renderMetricCard(_('Module Voltage'), getVoltageText(atInfo), atInfo.cbc && atInfo.cbc.millivolts ? (atInfo.cbc.millivolts + ' mV') : null, 'is-power', 'V'),
			renderMetricCard(_('Region'), regionInfo, mmInfo.location && mmInfo.location.lac ? ('LAC ' + mmInfo.location.lac) : null, 'is-region', 'R')
		]),
		E('div', { 'class': 'mb-overview-grid two-column' }, [
			E('div', { 'class': 'mb-section-card' }, [
				E('div', { 'class': 'mb-section-title' }, _('Module Information')),
				renderInfoTable([
					[ _('Manufacturer'), mmInfo.manufacturer || normalizeValue(bands.modem) || '--' ],
					[ _('Model'), mmInfo.model || normalizeValue(bands.modem) || '--' ],
					[ _('Revision'), mmInfo.revision || '--' ],
					[ _('IMEI'), mmInfo.imei || '--' ],
					[ _('Device Status'), mmInfo.state || '--' ],
					[ _('Failure Reason'), mmInfo.failReason || '--' ],
					[ _('Power State'), mmInfo.powerState || '--' ],
					[ _('Primary Port'), state.port || mmInfo.primaryPort || '--' ]
				])
			]),
			E('div', { 'class': 'mb-section-card' }, [
				E('div', { 'class': 'mb-section-title' }, _('Signal Details')),
				renderInfoTable([
					[ _('Access Technology'), accessInfo || '--' ],
					[ _('Registration State'), registration || '--' ],
					[ _('Serving Band'), servingBand || '--' ],
					[ _('Signal Details'), signalDetail || '--' ],
					[ 'TAC', atInfo.qeng && atInfo.qeng.tac ? atInfo.qeng.tac : mmInfo.location && mmInfo.location.tac ? mmInfo.location.tac : '--' ],
					[ 'CID', atInfo.qeng && atInfo.qeng.cellId ? atInfo.qeng.cellId : mmInfo.location && mmInfo.location.cid ? mmInfo.location.cid : '--' ],
					[ 'PCI', atInfo.qeng && atInfo.qeng.pci ? atInfo.qeng.pci : '--' ],
					[ 'ARFCN', atInfo.qeng && atInfo.qeng.arfcn ? atInfo.qeng.arfcn : '--' ]
				])
			])
		])
	]);
}

function renderStyle() {
	return E('style', [
		'.mb-overview-root{display:flex;flex-direction:column;gap:16px}',
		'.mb-hero-card{display:grid;grid-template-columns:minmax(86px,110px) 1fr;gap:18px;padding:18px;border:1px solid var(--border-color,#d9dfe7);border-radius:18px;background:linear-gradient(135deg,rgba(59,130,246,.10),rgba(255,255,255,.96) 55%,rgba(16,185,129,.08));box-shadow:0 10px 30px rgba(15,23,42,.06)}',
		'.mb-hero-icon{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}',
		'.mb-device-glyph{width:82px;height:82px;border-radius:22px;background:linear-gradient(160deg,#0f172a,#1d4ed8);display:flex;align-items:center;justify-content:center;box-shadow:0 14px 24px rgba(29,78,216,.22)}',
		'.mb-device-chip{display:inline-flex;align-items:center;justify-content:center;min-width:52px;height:52px;padding:0 10px;border-radius:16px;background:rgba(255,255,255,.14);color:#fff;font-size:1rem;font-weight:700;letter-spacing:.04em}',
		'.mb-device-signal{display:flex;align-items:flex-end;gap:4px;height:24px}',
		'.mb-signal-bar{display:block;width:8px;border-radius:999px;background:rgba(15,23,42,.12)}',
		'.mb-signal-bar.is-active{background:linear-gradient(180deg,#22c55e,#16a34a)}',
		'.mb-hero-copy{display:flex;flex-direction:column;justify-content:center;gap:8px;min-width:0}',
		'.mb-hero-kicker{font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#64748b)}',
		'.mb-hero-title{font-size:1.55rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.mb-hero-subtitle{display:flex;flex-wrap:wrap;gap:8px}',
		'.mb-pill{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:rgba(15,23,42,.06);font-size:.84rem;color:var(--text-color-high,#1f2937)}',
		'.mb-hero-meta{font-size:.92rem;color:var(--text-muted,#64748b)}',
		'.mb-spotlight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}',
		'.mb-spotlight-card{position:relative;overflow:hidden;border:1px solid var(--border-color,#d9dfe7);border-radius:18px;background:linear-gradient(180deg,var(--background-color-high,#fff),rgba(248,250,252,.94));padding:16px;box-shadow:0 10px 24px rgba(15,23,42,.06)}',
		'.mb-spotlight-card:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#94a3b8,#e2e8f0)}',
		'.mb-spotlight-card.is-operator:before{background:linear-gradient(90deg,#0ea5e9,#2563eb)}',
		'.mb-spotlight-card.is-cell:before{background:linear-gradient(90deg,#10b981,#22c55e)}',
		'.mb-spotlight-card.is-bands:before{background:linear-gradient(90deg,#f59e0b,#ef4444)}',
		'.mb-spotlight-title{display:flex;align-items:center;gap:8px;font-size:.92rem;color:var(--text-muted,#64748b);margin-bottom:10px}',
		'.mb-spotlight-value{font-size:1.45rem;font-weight:700;line-height:1.25;word-break:break-word}',
		'.mb-spotlight-subtitle{margin-top:8px;font-size:.92rem;color:var(--text-color-high,#334155);line-height:1.45;word-break:break-word}',
		'.mb-chip-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
		'.mb-status-chip{display:inline-flex;align-items:center;max-width:100%;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.06);color:var(--text-color-high,#334155);font-size:.82rem;font-weight:600;line-height:1.2;word-break:break-word}',
		'.mb-status-chip.is-band{background:rgba(37,99,235,.08);color:#1d4ed8}',
		'.mb-status-chip.is-family{background:rgba(245,158,11,.12);color:#b45309}',
		'.mb-status-chip.is-placeholder{color:var(--text-muted,#64748b);font-weight:500}',
		'.mb-detail-rows{display:grid;gap:10px;margin-top:14px}',
		'.mb-detail-row{display:flex;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--border-color-low,#e5e7eb)}',
		'.mb-detail-label{color:var(--text-muted,#64748b);font-size:.85rem}',
		'.mb-detail-value{color:var(--text-color-high,#0f172a);font-size:.9rem;text-align:right;word-break:break-word}',
		'.mb-band-focus{margin-top:4px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,rgba(245,158,11,.12),rgba(255,255,255,.95));border:1px solid rgba(245,158,11,.18)}',
		'.mb-band-focus-label{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#64748b)}',
		'.mb-band-focus-value{margin-top:6px;font-size:1.3rem;font-weight:700;word-break:break-word}',
		'.mb-band-focus-detail{margin-top:6px;font-size:.88rem;color:var(--text-muted,#64748b);line-height:1.4}',
		'.mb-band-grid{display:grid;gap:10px;margin-top:12px}',
		'.mb-band-group{padding:10px 12px;border-radius:14px;background:rgba(15,23,42,.03);border:1px solid var(--border-color-low,#e5e7eb)}',
		'.mb-band-group-title{font-size:.85rem;color:var(--text-muted,#64748b);margin-bottom:8px}',
		'.mb-band-chip-list{display:flex;flex-wrap:wrap;gap:6px}',
		'.mb-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}',
		'.mb-overview-grid.two-column{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}',
		'.mb-overview-card,.mb-section-card{position:relative;border:1px solid var(--border-color,#d9dfe7);border-radius:16px;background:var(--background-color-high,#fff);padding:16px;box-shadow:0 6px 18px rgba(15,23,42,.05)}',
		'.mb-overview-card:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;border-radius:16px 0 0 16px;background:linear-gradient(180deg,#cbd5e1,#94a3b8)}',
		'.mb-overview-card.is-signal:before{background:linear-gradient(180deg,#22c55e,#14b8a6)}',
		'.mb-overview-card.is-thermal:before{background:linear-gradient(180deg,#f59e0b,#ef4444)}',
		'.mb-overview-card.is-power:before{background:linear-gradient(180deg,#8b5cf6,#2563eb)}',
		'.mb-overview-card.is-region:before{background:linear-gradient(180deg,#0ea5e9,#06b6d4)}',
		'.mb-overview-card-title,.mb-section-title{display:flex;align-items:center;gap:8px;font-size:.92rem;color:var(--text-muted,#64748b);margin-bottom:10px}',
		'.mb-overview-card-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px}',
		'.mb-overview-card-value{font-size:1.5rem;font-weight:700;line-height:1.2;word-break:break-word}',
		'.mb-overview-card-detail{margin-top:8px;font-size:.9rem;color:var(--text-muted,#64748b);line-height:1.45;word-break:break-word}',
		'.mb-mini-bars{display:flex;align-items:flex-end;gap:2px;height:16px}',
		'.mb-mini-bar{display:block;width:3px;height:100%;background:#38bdf8;border-radius:999px}',
		'.mb-mini-bar:nth-child(1){height:25%}',
		'.mb-mini-bar:nth-child(2){height:50%}',
		'.mb-mini-bar:nth-child(3){height:75%}',
		'.mb-mini-bar:nth-child(4){height:100%}',
		'.mb-section-card .table{margin-bottom:0}',
		'.mb-section-card .table td{vertical-align:top}',
		'@media (max-width:780px){.mb-detail-row{flex-direction:column;align-items:flex-start}.mb-detail-value{text-align:left}}',
		'@media (max-width:640px){.mb-hero-card{grid-template-columns:1fr;gap:14px}.mb-hero-icon{flex-direction:row;justify-content:flex-start}.mb-hero-title{font-size:1.3rem}.mb-band-focus-value{font-size:1.1rem}}'
	].join('\n'));
}

return view.extend({
	loadRuntimeState: function() {
		return execJson(MMCLI_BIN, [ '-L', '-J' ]).then(function(list) {
			var index = list && Array.isArray(list['modem-list']) ? parseIndex(list['modem-list'][0]) : null;

			if (index == null)
				return null;

			return Promise.all([
				execJson(MMCLI_BIN, [ '-m', String(index), '-J' ]),
				execJson(MMCLI_BIN, [ '-m', String(index), '--location-get', '-J' ])
			]).then(function(results) {
				return {
					index: index,
					modem: results[0],
					location: results[1]
				};
			});
		});
	},

	loadAtState: function(port) {
		var tasks = [];
		var key;

		if (!port)
			return Promise.resolve(null);

		for (key in AT_COMMANDS) {
			tasks.push(execText(SMS_TOOL_BIN, [ '-d', port, 'at', AT_COMMANDS[key] ]).then(functionFactory(key)));
		}

		function functionFactory(commandKey) {
			return function(result) {
				return { key: commandKey, result: result };
			};
		}

		return Promise.all(tasks).then(function(results) {
			var raw = {};
			var parsed = {};
			var i;

			for (i = 0; i < results.length; i++)
				raw[results[i].key] = results[i].result;

			parsed.csq = parseCSQ(raw.csq || '');
			parsed.cops = normalizeValue(raw.cops);
			parsed.qnwinfo = parseQNWINFO(raw.qnwinfo || '');
			parsed.qtemp = parseTemperature(raw.qtemp || '');
			parsed.cbc = parseCBC(raw.cbc || '');
			parsed.qeng = parseQENG(raw.qeng || '');
			parsed.raw = raw;

			return parsed;
		});
	},

	fetchState: function() {
		var self = this;

		return Promise.all([
			execJson(MODEMBAND_BIN, [ 'json' ]),
			this.loadRuntimeState(),
			uci.load('modemband')
		]).then(function(results) {
			var bands = results[0] || {};
			var mmState = results[1];
			var mmInfo = getMmInfo(mmState);
			var configuredPort = normalizePort(uci.get('modemband', '@modemband[0]', 'set_port'));
			var port = configuredPort || mmInfo.primaryPort || null;

			return self.loadAtState(port).then(function(atInfo) {
				return {
					bands: bands,
					mmAvailable: !!mmState,
					mmState: mmState,
					mmInfo: mmInfo,
					atInfo: atInfo,
					port: port
				};
			});
		});
	},

	load: function() {
		return this.fetchState();
	},

	render: function(state) {
		var root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Modem Overview')),
			E('div', { 'class': 'cbi-map-descr' }, _('Runtime data source: ModemManager (mmcli); band data source: modemband.')),
			renderStyle(),
			E('div')
		]);
		var container = root.lastElementChild;
		var self = this;

		dom.content(container, renderOverview(state));

		poll.add(function() {
			return self.fetchState().then(function(nextState) {
				dom.content(container, renderOverview(nextState));
			});
		}, 10);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});