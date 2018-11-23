const config = {
    general: {
        gatewayHost: {
            type: "String",
        }
    },
    deviceSchemas: [
        {
            name: "Binary switch",
            type: "binarySwitch",
            description: `This is typical binary switch with optional status and control. All parameters are KNX group addresses`,
            power_control: {
                type: "String",
                optional: true
            },
            power_status: {
                type: "Array",
                optional: true
            },
            'power_status.$': {
                type: "String",
                optional: true
            },
        },
        {
            name: "Dimmable light",
            type: "dimmableLight",
            description: `This is % dimmable lignt with ON/OFF status and control. All parameters are KNX group addresses`,
            power_control: {
                type: "String",
                optional: true
            },
            power_status: {
                type: "Array",
                optional: true
            },
            'power_status.$': {
                type: "String",
                optional: true
            },
            brightness_control: {
                type: "String",
                optional: true
            },
            brightness_status: {
                type: "String",
                optional: true
            }
        },
        {
            name: "Room controller (% heat, % cool)",
            type: "roomController1",
            description: `Compatible with Siemens UP254 in 0-100% mode`,
            temperature: {
                type: "String"
            },
            temperatureSetpoint: {
                type: "String"
            },
            comfortMode: {
                type: "String",
                optional: true
            },
            heat: {
                type: "String",
                optional: true
            },
            cool: {
                type: "String",
                optional: true
            },
        }
    ],
    actions: [
        {
            name: "Disconnect",
            schema: {}
        },
        {
            name: "Read group address",
            schema: {
                address: "String"
            }
        },
        {
            name: "Write group address",
            schema: {
                address: "String",
                value: "String",
                dpt: "String"
            }
        }
    ]
};

module.exports = config;