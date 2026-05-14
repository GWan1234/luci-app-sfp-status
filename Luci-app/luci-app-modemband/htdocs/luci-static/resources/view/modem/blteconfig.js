'use strict';
'require form';
'require fs';
'require view';
'require uci';
'require ui';
'require tools.widgets as widgets'

/*
	Copyright 2022-2024 Rafał Wabik - IceG - From eko.one.pl forum
*/

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.list('/dev'), []).then(function(devs) {
				return devs.filter(function(dev) {
					return dev.name.match(/^ttyUSB/) || dev.name.match(/^cdc-wdm/) || dev.name.match(/^ttyACM/) || dev.name.match(/^mhi_/) || dev.name.match(/^wwan/);
				});
			}),
			L.resolveDefault(fs.exec_direct('/usr/bin/loaded.sh', [ 'json' ]), '{}')
		]);
	},

	renderStyle: function() {
		return E('style', { 'type': 'text/css' }, [
			'.modemband-settings-page .cbi-map { max-width: 1180px; }',
			'.modemband-settings-page .cbi-section {',
				'border: 1px solid rgba(148, 163, 184, 0.24);',
				'border-radius: 20px;',
				'overflow: hidden;',
				'box-shadow: 0 18px 38px rgba(15, 23, 42, 0.08);',
				'background: var(--modemband-card-bg, var(--background-color-secondary, rgba(255, 255, 255, 0.96)));',
			'}',
			'.modemband-settings-page .cbi-map-descr { max-width: 72ch; margin-bottom: 1.25rem; }',
			'.modemband-settings-page .cbi-tabmenu {',
				'display: flex;',
				'flex-wrap: wrap;',
				'gap: 0.6rem;',
				'padding: 1.1rem 1.2rem 0;',
				'margin: 0;',
				'border-bottom: 1px solid rgba(148, 163, 184, 0.18);',
			'}',
			'.modemband-settings-page .cbi-tabmenu li { margin: 0 0 0.9rem; }',
			'.modemband-settings-page .cbi-tabmenu li a {',
				'border-radius: 999px;',
				'padding: 0.62rem 1rem;',
				'font-weight: 600;',
				'background: var(--modemband-tab-bg, rgba(226, 232, 240, 0.72));',
				'border: 1px solid transparent;',
				'transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;',
			'}',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab > a:hover,',
			'.modemband-settings-page .cbi-tabmenu li.cbi-tab-active > a {',
				'background: var(--modemband-tab-active-bg, var(--modemband-card-bg, rgba(255, 255, 255, 0.98)));',
				'border-color: rgba(59, 130, 246, 0.24);',
				'transform: translateY(-1px);',
			'}',
			'.modemband-settings-page .cbi-section-node .cbi-value,',
			'.modemband-settings-page .cbi-section-node .cbi-section-table-row {',
				'padding-left: 1.2rem;',
				'padding-right: 1.2rem;',
			'}',
			'.modemband-settings-page .cbi-section-node textarea {',
				'min-height: 26rem;',
				'font-family: Consolas, Monaco, monospace;',
				'line-height: 1.55;',
			'}',
			'.modemband-settings-page .cbi-value-description { max-width: 72ch; }',
			'@media (max-width: 768px) {',
				'.modemband-settings-page .cbi-section { border-radius: 16px; }',
				'.modemband-settings-page .cbi-tabmenu { padding: 1rem 0.9rem 0; gap: 0.45rem; }',
				'.modemband-settings-page .cbi-section-node .cbi-value,',
				'.modemband-settings-page .cbi-section-node .cbi-section-table-row {',
					'padding-left: 0.9rem;',
					'padding-right: 0.9rem;',
				'}',
			'}'
		].join('\n'));
	},

	render: function(data) {
		var devs = data[0] || [];
		var loadedData = data[1];
		var json = {};
		var modemName = '';
		var m, s, o;

		try {
			json = JSON.parse(loadedData || '{}');
		}
		catch (err) {
			ui.addNotification(null, E('p', _('Waiting to read data from the modem...')), 'warning');
			json = {};
		}

		modemName = (typeof(json.modem) == 'string') ? json.modem : '';

		m = new form.Map('modemband', _('Configuration'), _('Manage modem communication, restart behavior and template customization from one page.'));

		s = m.section(form.TypedSection, 'modemband', null, null);
		s.anonymous = true;
		s.addremove = false;
		s.tab('general', _('Device communication'));
		s.tab('actions', _('Restart and notification behavior'));
		s.tab('template', _('Template selection'));
		s.tab('editor', _('Template editor'));

		o = s.taboption('general', widgets.NetworkSelect, 'iface', _('Interface'),
			_('Network interface for Internet access.')
		);
		o.exclude = s.section;
		o.nocreate = true;
		o.rmempty = false;
		o.default = 'wan';

		o = s.taboption('general', form.Value, 'set_port', _('Port for communication with the modem'),
			_('Select one of the available ttyUSBX ports.'));
		devs.sort(function(a, b) {
			return String(a.name).localeCompare(String(b.name));
		});
		devs.forEach(function(dev) {
			o.value('/dev/' + dev.name);
		});
		o.placeholder = _('Please select a port');
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'wanrestart', _('Restart WAN'),
			_('WAN restart after making changes to bands.')
		);
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'modemrestart', _('Modem restart'),
			_('Modem restart after making changes to bands.')
		);
		o.rmempty = false;

		o = s.taboption('actions', form.Value, 'restartcmd', _('Restart with AT command'),
			_('AT command to restart the modem.')
		);
		o.default = 'AT+CFUN=1,1';
		o.depends('modemrestart', '1');
		o.rmempty = false;

		o = s.taboption('actions', form.Flag, 'notify', _('Turn off notifications'),
			_('Checking this option disables the notification that appears every time the bands are changed.')
		);
		o.rmempty = false;

		o = s.taboption('template', form.DummyValue, '_template_loaded', _('Template loaded'));
		o.cfgvalue = function() {
			return 'modemband / ' + (modemName.length > 1 ? modemName : '-');
		};

		o = s.taboption('template', form.ListValue, 'modemid', _('Select the modem settings file'),
			_('Select the template assigned to the Vendor and ProdID of the modem.'));
		o.load = function(section_id) {
			return L.resolveDefault(fs.list('/usr/share/modemband'), []).then(L.bind(function(modems) {
				if (modems.length > 0) {
					modems.sort(function(a, b) {
						return String(a.name).localeCompare(String(b.name));
					});
					modems.forEach(function(entry) {
						if (entry && /^\d/.test(entry.name))
							this.value(entry.name);
					}, this);
				}
				return this.super('load', [ section_id ]);
			}, this));
		};
		o.rmempty = false;
		o.default = modemName;
		o.cfgvalue = function(section_id) {
			return uci.get('modemband', section_id, 'modemid') || modemName;
		};
		o.write = function(section_id, value) {
			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(value).join(' '));
		};
		o.onchange = function(ev, section_id, value) {
			uci.set('modemband', '@modemband[0]', 'modemid', L.toArray(value).join(' '));
			return uci.save().then(function() {
				return uci.apply();
			}).then(function() {
				window.setTimeout(function() {
					location.reload();
				}, 1000);
			});
		};

		o = s.taboption('editor', form.TextValue, '_tmpl', _('Edit'),
			_('Supported bands depend on the region in which the modem operates. By modifying the DEFAULT_LTE_BANDS variable, you can easily adapt the package to your modem.'));
		o.rows = 18;
		o.cfgvalue = function() {
			if (modemName.length > 1)
				return fs.trimmed('/usr/share/modemband/' + modemName);

			return '';
		};
		o.write = function(section_id, formvalue) {
			if (modemName.length < 1)
				return;

			return fs.write('/usr/share/modemband/' + modemName, String(formvalue || '').trim().replace(/\r\n/g, '\n') + '\n');
		};

		return m.render().then(L.bind(function(mapEl) {
			return E('div', { 'class': 'modemband-settings-page' }, [
				this.renderStyle(),
				mapEl
			]);
		}, this));
	}
});
