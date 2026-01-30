package mapper

import (
	"encoding/json"

	"gorm.io/datatypes"
)

func encodeJSON(value map[string]interface{}) datatypes.JSON {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return datatypes.JSON(data)
}

func decodeJSON(value datatypes.JSON) map[string]interface{} {
	if len(value) == 0 {
		return nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(value, &payload); err != nil {
		return nil
	}
	return payload
}
