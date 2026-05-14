'use strict';
'require view';
'require fs';
'require form';
'require ui';
'require uci';
'require tools.widgets as widgets';

/*
	Copyright 2022-2024 Rafał Wabik - IceG - From eko.one.pl forum
	
	MIT License
*/


return view.extend({
	load: function() {
		return L.resolveDefault(fs.exec_direct('/usr/bin/loaded.sh', [ 'json' ]));
	},

	render: function(data) {
		var m, s, o;
		var json = {};
		var modemName = '';

		try {
			json = JSON.parse(data || '{}');
		}
		catch (err) {
			ui.addNotification(null, E('p', _('Waiting to read data from the modem...')), 'warning');
			json = {};
		}

		modemName = (typeof(json.modem) == 'string') ? json.modem : '';

		m = new form.Map('modemband', _('Modem template configuration'), _('Settings panel for the modemband application that allows you to customize the package for your modem.'));

		s = m.section(form.TypedSection, 'modemband', '', _(''));
		s.anonymous = true;

		s.tab('general',  _('General Settings'));
		if (modemName.length > 1) {
			s.tab('template', _('Edit script'), _());
			o = s.taboption('template', form.DummyValue, modemName, _('Template loaded'));
			o.default = '' || _('modemband / ' + modemName);
		}
		else {

			s.tab('template', _('Edit script'), _());
			o = s.taboption('template', form.DummyValue, '', _('Template loaded'));
			o.default = '' || _('modemband / ');
		}

		function handleIDChange(ev, section_id, value) {
			var mid = this.section.getUIElement(section_id, 'modemid');

			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(mid.getValue()).join(' '));
			uci.save();
			uci.apply();

			window.setTimeout(function() {
				location.reload();
			}, 2000);

		}

		o = s.taboption('template', form.TextValue, '_tmpl', _('Edit'),
			_('Supported bands depend on the region in which the modem operates. By modifying the DEFAULT_LTE_BANDS variable, you can easily adapt the package to your modem.'));
		o.rows = 7;
		o.cfgvalue = function(section_id) {
		if (modemName.length > 1) {
			return fs.trimmed('/usr/share/modemband/' + modemName);
		}

		return '';

		};

		o.write = function(section_id, formvalue) {
			if (modemName.length < 1)
				return;

			return fs.write('/usr/share/modemband/' + modemName, formvalue.trim().replace(/\r\n/g, '\n') + '\n');
		};

		o = s.taboption('template', form.ListValue, 'modemid',_('Select the modem settings file'),
			_("Select the template assigned to the Vendor and ProdID of the modem."));
		o.load = function(section_id) {
			return L.resolveDefault(fs.list('/usr/share/modemband'), []).then(L.bind(function(modems) {
				if(modems.length > 0) {
				modems.sort(function(a, b) {
					return String(a.name).localeCompare(String(b.name));
				});
					modems.forEach(function(element) {
        				if (element !== modems[0]) {
						if (!isNaN(element.name.charAt(0))){
 							 o.value(element.name);
						}
        				}
    				});
				}
				return this.super('load', [section_id]);
			}, this));
		};
		o.rmempty = false;
		o.default = '' || modemName;
		o.cfgvalue = function(section_id) {
			return uci.get('modemband', section_id, 'modemid');
		};
		o.write = function(section_id, value) {
			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(value).join(' '));
			uci.save();
			uci.apply();
		};
		o.onchange = handleIDChange;

		return m.render();
	},

	handleSaveApply: null,
	handleReset: null
});
