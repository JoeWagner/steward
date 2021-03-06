// Z-wave dimmer switches

var registrar
  , utility     = require('./../../core/utility')
  ;

try {
  registrar = require('./../devices-gateway/gateway-openzwave-usb');
  if (!registrar.pair) throw new Error('openzwave-usb gateway unable to start');
} catch(ex) {
  exports.start = function() {};

  return utility.logger('devices').info('failing zwave-dimmer switch (continuing)', { diagnostic: ex.message });
}

var util        = require('util')
  , devices     = require('./../../core/device')
  , steward     = require('./../../core/steward')
  , plug        = require('./../device-switch')
  ;


var logger = plug.logger;


var ZWave_Dimmer = exports.Device = function(deviceID, deviceUID, info) {
  var self = this;
  var bri;

  self.whatami = info.deviceType;
  self.deviceID = deviceID.toString();
  self.deviceUID = deviceUID;
  self.name = info.device.name;
  self.getName();

  bri = info.peripheral.classes[0x26][0];

  self.status = bri.value > 0 ? 'on' : 'off';
  self.changed();
  self.driver = info.driver;
  self.peripheral = info.peripheral;
  self.info = { level: bri.value };

  utility.broker.subscribe('actors', function(request, taskID, actor, perform, parameter) {
    if (actor !== ('device/' + self.deviceID)) return;

    if (request === 'perform') return self.perform(self, taskID, perform, parameter);
  });

  self.driver.enablePoll(self.peripheral.nodeid, 0x26);
};
util.inherits(ZWave_Dimmer, plug.Device);


ZWave_Dimmer.prototype.update = function(self, event, comclass, value) {
  if (event === 'value added') event = 'value changed';

  var f = { 'value changed' :
              function() {
                if (!self.peripheral.classes[comclass]) self.peripheral.classes[comclass] = {};
                self.peripheral.classes[comclass][value.index] = value;
                if ((comclass !== 0x26) || (value.index !== 0)) return;

                self.status = value.value > 0 ? 'on' : 'off';
                self.info = { level: value.value };
                self.changed();
              }

          , 'value removed' :
              function() {
                try { delete(self.peripheral.classes[comclass][value]); } catch(ex) {}

// TBD: something to do here?
              }

          , 'notification'  :
              function() {
                logger.warning('device/' + self.deviceID, { event: 'notification', value: value });

// TBD: something to do here?
              }
  };
  if (!!f[event]) return (f[event])();

  logger.warning('device/' + self.deviceID,
    { event: event, comclass: comclass, value: value, diagnostic: 'unexpected update' });
};


ZWave_Dimmer.prototype.perform = function(self, taskID, perform, parameter) {
  var params, state;

  try { params = JSON.parse(parameter); } catch(ex) { params = {}; }

  if (perform === 'set') {
    if (!!params.name) self.driver.setName(self.peripheral.nodeid, params.name);
    if (!!params.physical) self.driver.setLocation(self.peripheral.nodeid, params.physical);

    return ((!params.name) || self.setName(params.name, taskID));
  }

  state = {};
  if (perform === 'off') state.level = 0;
  else if (perform === 'on') state.level = (params.level > 0 && params.level < 100) ? params.level : 50;
  else return false;

  state.status = state.level > 0 ? 'on' : 'off';

  if (self.status !== state.status || self.info.level !== state.level) {
    logger.info('device/' + self.deviceID, state);
    self.driver.setLevel(self.peripheral.nodeid, state.level);
    self.changed();
    return steward.performed(taskID);
  }
};


var validate_perform = function(perform, parameter) {
  var params = {}
    , result = { invalid: [], requires: [] }
    ;

  if (!!parameter) try { params = JSON.parse(parameter); } catch(ex) { result.invalid.push('parameter'); }

  if (perform === 'off') return result;

  if (perform === 'set') {
    if ((!params.name) && (!params.physical)) result.requires.push('name');
    return result;
  }

  if (perform !== 'on') result.invalid.push('perform');

  if ((!!params.level) && (!plug.validLevel(params.level))) result.invalid.push('level');

  return result;
};


/* DEPRECATED
var manufacturers =
{ '001a' : { '0003' : { name: 'Aspire RF Dimmer',                    deviceType: '/device/switch/cooper/dimmer' } }
, '0063' : { '3030' : { name: 'Lamp Dimmer/Plugin Appliance Module', deviceType: '/device/switch/ge/dimmer'     } }
};
 */

exports.start = function() {
  steward.actors.device['switch'].zwave = steward.actors.device['switch'].zwave ||
      { $info     : { type: '/device/switch/zwave' } };

  steward.actors.device['switch'].zwave.dimmer =
      { $info     : { type       : '/device/switch/zwave/dimmer'
                    , observe    : [ ]
                    , perform    : [ 'off', 'on' ]
                    , properties : { name     : true
                                   , status   : [ 'on', 'off' ]
                                   , physical : true
                                   , level    : 'percentage'
                                   }
                    }
      , $validate : { perform    : validate_perform }
      };
  devices.makers['/device/switch/zwave/dimmer'] = ZWave_Dimmer;
  registrar.pair(0x26, '/device/switch/zwave/dimmer'); // COMMAND_CLASS_SWITCH_MULTILEVEL

/* DEPRECATED
  registrar.register(ZWave_Dimmer, '/device/switch/zwave/dimmer', manufacturers);
 */
};
