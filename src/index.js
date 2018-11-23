const axios = require('axios');
const mqtt = require('async-mqtt');
const config = require('./config');
const configurationSchema = require('./schemas');
const logTopic = `apps/${config.appId}/log`;
const commandTopic = `apps/${config.appId}/command`;
const notifyTopic = `apps/${config.appId}/notify`;
var knx = require('knx');

let appParams = {};
let devices;
let knxconnection = null;

let mqttConnected = false;
let registeredControls = {};

/**
 * 1. setConfigurationSchema
        1. General config
        2. DeviceSchemas
        3. Actions
    2. createDevice | update | delete
    3. createDataPoint | update | delete
    4. getDevices
 */
let client = mqtt.connect(config.foraMQTT, {
    username: `app:${config.appId}`,
    password: config.appToken,
    will: {
        topic: `apps/${config.appId}/online`,
        payload: "false",
        retain: true
    }
});

client.on('connect',  function () {
    mqttConnected = true;
    console.log("Connected to Fora")
    log('MQTT is connected')
    client.publish(`apps/${config.appId}/online`, "true", {retain: true})
    client.subscribe(commandTopic)
    client.subscribe(notifyTopic)
    log('Subscribed to command topic: '+ commandTopic)
})

client.on('reconnect', function() {
    log('MQTT reconnect attempt')
})

client.on('disconnect',  function () {
    mqttConnected = false;
    log('MQTT disconnected')
})


client.on('offline',  function () {
    mqttConnected = false;
    log('MQTT is offline')
})

function connectKNX(){
    if (appParams) {
        knxconnection = knx.Connection({
            ipAddr: appParams.gatewayHost, 
            ipPort: 3671,
            handlers: {
                connected: function() {
                    console.log('KNX connected!');
                    log("KNX connected")
                },
                event: function (evt, src, dest, value) {
                    var logStr = `${evt}, ${src}, ${dest}, ${JSON.stringify(value)}`;
                    log(logStr)
                    console.log(logStr)

                }
            }
        });
    }
}

async function readDevices() {
    try {
        const result = await axios({
            method: 'GET',
            url: `${config.foraAPI}/api/v1/apps/${config.appId}/devices`, 
            headers: { 
                'Authorization': `Bearer ${config.appToken}`
            }
        });
        // console.log("DEVICES: ", result.data)
        devices = result.data;
        devices.forEach(element => {
            createDevice(element)
        }); 
  
    } catch (error) {
        console.log(error.message)
    }    
}

async function readConfig() {
    try {
        const result = await axios({
            method: 'GET',
            url: `${config.foraAPI}/api/v1/apps/${config.appId}`, 
            headers: { 
                'Authorization': `Bearer ${config.appToken}`
            }
        });
        // console.log(result.data)
        appParams = result.data.config;
        connectKNX()
        await readDevices()
        // console.log(appParams)
    } catch (error) {
        console.log(error.message)
    }
}


client.on('message',  async function (topic, message) {

    console.log("MESSAGE", topic, message.toString())
    if (topic === commandTopic) {
        console.log("Command topic received")
    }

    if (topic === notifyTopic) {
        console.log("Notify topic received")
        if (message.toString()==="reloadApplication") {
            readConfig()
        }   
    }

    if (registeredControls[topic]) {
        registeredControls[topic].forEach(({ga, resendTopic})=>{
            console.log("REGISTERED CONTROL TOPIC:", topic, message.toString())
            ga.write(JSON.parse(message.toString()))
            if(resendTopic) {
                client.publish(resendTopic, message.toString(), {retain: true})
            }
        })
    }
})


client.on('error', function(error){
    console.log(error)
})

async function log(message) {
    if (mqttConnected) {
        await client.publish(logTopic, message)
    } else {
        console.log("Not connected log: ", message)
    }
}

async function start(){
    //const strConfig = JSON.stringify(configurationSchema);
    
    const result = await axios({
        method: 'POST',
        url: `${config.foraAPI}/api/v1/apps/${config.appId}/setConfigSchema`, 
        data: {config: configurationSchema},
        headers: { 
            'Authorization': `Bearer ${config.appToken}`
        }
    });
    readConfig();
    //console.log(result.data)
}

start()

/** create devices */

let mqttdatapoints = {}
let knxdatapoints = {}

const createDevice = function(device) {
    var fc = deviceTypes[device.general.type]
    if (fc) {
        fc(device)
    } else {
        console.log("ERROR TYPE NOT FOUND")
    }
}

async function findOrCreateDataPoint(device, dpName, dpconfig) {
    var foundDP = device.datapoints.find((dp)=>{return dp.name===dpName})
    var result = {};

    if (!foundDP) {
        const dp2create = {
            deviceId: device._id,
            name: dpName,
            config: dpconfig
        };

        result = await axios({
            method: 'POST',
            url: `${config.foraAPI}/api/v1/datapoints`, 
            data: dp2create,
            headers: { 
                'Authorization': `Bearer ${config.appToken}`
            }
        });
    }    

    return foundDP || result.data;
}

//roomController1

function registerControl(topic, ga, resendTopic) {
    if (registeredControls[topic]) {
        registeredControls[topic].push({ga, resendTopic})
    } else {
        registeredControls[topic] = [{ga, resendTopic}]
    }
}

const roomController1 = async function(device) {
    console.log(device)
    var temperatureDp = await findOrCreateDataPoint(device, "temperature", {
            type: "Number",
            isControllable: false,
            isStatusable: true,
            measurementUnit: "°C"
    });
    var setpointDp = await findOrCreateDataPoint(device, "temperatureSetpoint", {
        type: "Number",
        isControllable: false,
        isStatusable: true,
        measurementUnit: "°C",
        min: 5,
        max: 35,
        step: 0.1
    });

 
    
    var temperatureDp_ga = new knx.Datapoint({
        ga: device.config.temperature,
        dpt: 'DPT9.001'
    }, knxconnection);
    
    temperatureDp_ga.on('change', function(oldvalue, newvalue) {
        client.publish(`dps/${temperatureDp._id}`, `${newvalue.toFixed(2)}`, {retain: true})
        
    });

    var setpointDp_ga = new knx.Datapoint({
        ga: device.config.temperatureSetpoint,
        dpt: 'DPT9.001'
    }, knxconnection);
    
    setpointDp_ga.on('change', function(oldvalue, newvalue) {
        client.publish(`dps/${setpointDp._id}`, `${newvalue.toFixed(2)}`, {retain: true})
        
    });
    
    client.subscribe(`dps/${setpointDp._id}/control`);
    registerControl(`dps/${setpointDp._id}/control`, setpointDp_ga, `dps/${setpointDp._id}`)

    var modeDp = await findOrCreateDataPoint(device, "comfortMode", {
        type: "Boolean",
        isControllable: true,
        isStatusable: true,
        measurementUnit: "Comf|Eco",
    });

    var modeDp_ga = new knx.Datapoint({
        ga: device.config.comfortMode,
        dpt: 'DPT1.001'
    }, knxconnection);
    console.log(`COMFORT MODE GA: "${device.config.comfortMode}"`)
    modeDp_ga.on('change', function(oldvalue, newvalue) {
        client.publish(`dps/${modeDp._id}`, `${newvalue}`, {retain: true})
    });
    
    client.subscribe(`dps/${modeDp._id}/control`);
    registerControl(`dps/${modeDp._id}/control`, modeDp_ga, `dps/${modeDp._id}`)

    var heatDp = await findOrCreateDataPoint(device, "heat", {
        type: "Number",
        isControllable: false,
        isStatusable: true,
        measurementUnit: "%",
    });

    var heatDp_ga = new knx.Datapoint({
        ga: device.config.heat,
        dpt: 'DPT5.001'
    }, knxconnection);

    heatDp_ga.on('change', function(oldvalue, newvalue) {
        client.publish(`dps/${heatDp._id}`, `${newvalue}`, {retain: true})
    });
    
    var coolDp = await findOrCreateDataPoint(device, "cool", {
        type: "Number",
        isControllable: false,
        isStatusable: true,
        measurementUnit: "%",
    });

    var coolDp_ga = new knx.Datapoint({
        ga: device.config.cool,
        dpt: 'DPT5.001'
    }, knxconnection);

    coolDp_ga.on('change', function(oldvalue, newvalue) {
        console.log("COOL", newvalue)
        client.publish(`dps/${coolDp._id}`, `${newvalue}`, {retain: true})
    });
    

   
}

const dimmableLightCreate = async function(device) {
    //console.log(device)
    var powerDp = await findOrCreateDataPoint(device, "power", {
            type: "Boolean",
            isControllable: !!device.config.power_control,
            isStatusable: !!device.config.power_status,
            measurementUnit: "ON|OFF"
    });
    var brightnessDp = await findOrCreateDataPoint(device, "brightness", {
        type: "Number",
        isControllable: !!device.config.power_control,
        isStatusable: !!device.config.power_status,
        measurementUnit: "%",
        min: 0,
        max: 100
    });
    
    if (powerDp.config.isStatusable) {
        if (typeof device.config.power_status === 'string') {
            var power_status_ga = new knx.Datapoint({
                ga: device.config.power_status,
                dpt: 'DPT1.001'
            }, knxconnection);
            
            power_status_ga.on('change', function(oldvalue, newvalue) {
                if (oldvalue !== null) {
                    client.publish(`dps/${powerDp._id}`, `${newvalue}`, {retain: true})
                }
            });
        } else {
            device.config.power_status.forEach(power_status=>{
                var power_status_ga = new knx.Datapoint({
                    ga: power_status,
                    dpt: 'DPT1.001'
                }, knxconnection);
                
                power_status_ga.on('change', function(oldvalue, newvalue) {
                    if (oldvalue !== null) {
                        client.publish(`dps/${powerDp._id}`, `${newvalue}`, {retain: true})
                    }
                });
            })
        }
    }
    if (powerDp.config.isControllable) {
        var power_control_ga = new knx.Datapoint({
            ga: device.config.power_control,
            dpt: 'DPT1.001'
        }, knxconnection);
        
        //console.log("SUB", `dps/${powerDp._id}/control`);
        client.subscribe(`dps/${powerDp._id}/control`);
        registerControl(`dps/${powerDp._id}/control`,power_control_ga,`dps/${powerDp._id}`)

        // client.on('message',  async function (topic, message) {
            
        //     if (topic == `dps/${powerDp._id}/control`) {
        //         console.log("RECEIVED CONTROL", message.toString(), typeof message)
        //         power_control_ga.write(JSON.parse(message.toString()))

        //         if (powerDp.config.isStatusable && device.config.power_control == device.config.power_status) {
        //             client.publish(`dps/${powerDp._id}`, message.toString(), {retain: true})
        //         } 
        //     }           
        // })
    }

    // BRIGHTNESS
    if (brightnessDp.config.isStatusable) {
        var brightness_status_ga = new knx.Datapoint({
            ga: device.config.brightness_status,
            dpt: 'DPT5.001'
        }, knxconnection);
        
        brightness_status_ga.on('change', function(oldvalue, newvalue) {
            if (oldvalue !== null) {
                client.publish(`dps/${brightnessDp._id}`, `${newvalue}`, {retain: true})
            }
        });
    }
    if (brightnessDp.config.isControllable) {
        var brightness_control_ga = new knx.Datapoint({
            ga: device.config.brightness_control,
            dpt: 'DPT5.001'
        }, knxconnection);
        
        //console.log("SUB", `dps/${brightnessDp._id}/control`);
        client.subscribe(`dps/${brightnessDp._id}/control`);
        registerControl(`dps/${brightnessDp._id}/control`,brightness_control_ga,`dps/${brightnessDp._id}`)
        
        // client.on('message',  async function (topic, message) {
            
        //     if (topic == `dps/${brightnessDp._id}/control`) {
        //         console.log("RECEIVED CONTROL", message.toString(), typeof message)
        //         brightness_control_ga.write(JSON.parse(message.toString()))

        //         if (brightnessDp.config.isStatusable && device.config.brightness_control == device.config.brightness_status) {
        //             client.publish(`dps/${brightnessDp._id}`, message.toString(), {retain: true})
        //         } 
        //     }           
        // })
    }
}


const binarySwitchCreate = async function(device) {

    var expectedName = "power"
    var foundDP = device.datapoints.find((dp)=>{return dp.name===expectedName})
    var result = {};

    if (!foundDP) {
        const device2create = {
            deviceId: device._id,
            name: "power",
            config: {
                type: "Boolean",
                isControllable: !!device.config.power_control,
                isStatusable: !!device.config.power_status,
                measurementUnit: "ON|OFF"
            }
        };
        result = await axios({
            method: 'POST',
            url: `${config.foraAPI}/api/v1/datapoints`, 
            data: device2create,
            headers: { 
                'Authorization': `Bearer ${config.appToken}`
            }
        });
    }    

    foundDP = foundDP || result.data;

    //var statusTopic = `dps/${foundDP._id}`;


    if (foundDP.config.isStatusable) {
        if (typeof device.config.power_status === 'string') {
            var status_ga = new knx.Datapoint({
                ga: device.config.power_status,
                dpt: 'DPT1.001'
            }, knxconnection);
            
            status_ga.on('change', function(oldvalue, newvalue) {
                if (oldvalue !== null) {
                    client.publish(`dps/${foundDP._id}`, `${newvalue}`, {retain: true})
                }
            });
        } else {
            device.config.power_status.forEach(power_status=>{
                var status_ga = new knx.Datapoint({
                    ga: power_status,
                    dpt: 'DPT1.001'
                }, knxconnection);
                
                status_ga.on('change', function(oldvalue, newvalue) {
                    if (oldvalue !== null) {
                        client.publish(`dps/${foundDP._id}`, `${newvalue}`, {retain: true})
                    }
                });
            })
        }
    }
    if (foundDP.config.isControllable) {
        var control_ga = new knx.Datapoint({
            ga: device.config.power_control,
            dpt: 'DPT1.001'
        }, knxconnection);
        
        client.subscribe(`dps/${foundDP._id}/control`);
        registerControl(`dps/${foundDP._id}/control`,control_ga,`dps/${foundDP._id}`)
        // client.on('message',  async function (topic, message) {

        //     if (topic == controlTopic) {
        //         console.log("RECEIVED CONTROL", message.toString(), typeof message)
        //         control_ga.write(JSON.parse(message.toString()))

        //         if (foundDP.config.isStatusable && device.config.power_control == device.config.power_status) {
        //             client.publish(statusTopic, message.toString(), {retain: true})
        //         } 
        //     }           
        // });
    }
}

const deviceTypes = {
    "binarySwitch": binarySwitchCreate,
    "dimmableLight": dimmableLightCreate,
    "roomController1": roomController1
}

