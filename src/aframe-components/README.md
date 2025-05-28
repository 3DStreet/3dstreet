# Docs for custom A-Frame components used with 3DStreet

## Street-geo component

The components accept longitude, latitude, elevation and an array of map types to indicate which child maps to spawn. Possible values for maps array: 'mapbox2d', 'google3d'.
 
 The component assigns the class 'autocreated' to its child elements. All attribute values can be changed at runtime and the component will update the child elements (map entities) and their corresponding parameters. The 'elevation' attribute is only used for the 'google3d' tiles element for now.
 
To add support for a new map type, you need to take the following steps:
* add map name to this.mapTypes variable
* add creating function with name: `<mapName>Create`
* add update function with name: `<mapName>Update`

It is assumed that the appropriate libraries for all map types are loaded in advance.