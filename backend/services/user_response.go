package services

import "network_automation/entity"

type UserResponse struct {
	ID              uint   `json:"id"`
	Email           string `json:"email"`
	FirstName       string `json:"first_name"`
	LastName        string `json:"last_name"`
	Profile         string `json:"profile"`
	PhoneNumber     string `json:"phone_number"`
	Location        string `json:"location"`
	Position        string `json:"position"`
	Role            string `json:"role"`
	AuthProvider    string `json:"auth_provider"`
	PasswordExpired bool   `json:"password_expired"`
	ThemeMode       string `json:"theme_mode"`
	ThemeColor      string `json:"theme_color"`
}

func MapUserResponse(u entity.AppUser) UserResponse {
	role := ""
	if u.AppRole != nil {
		role = u.AppRole.Role
	}
	themeMode := u.ThemeMode
	if themeMode == "" {
		themeMode = "System"
	}
	themeColor := u.ThemeColor
	if themeColor == "" {
		themeColor = "#1A97F5"
	}
	return UserResponse{
		ID:           u.ID,
		Email:        u.Email,
		FirstName:    u.FirstName,
		LastName:     u.LastName,
		Profile:      u.Profile,
		PhoneNumber:  u.PhoneNumber,
		Location:     u.Location,
		Position:     u.Position,
		Role:         role,
		AuthProvider: u.AuthProvider,
		ThemeMode:    themeMode,
		ThemeColor:   themeColor,
	}
}
