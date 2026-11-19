package user

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/asaskevich/govalidator"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// hexColorRe ตรวจสอบรูปแบบสีแบบ hex เช่น #10B981
var hexColorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type CreateUserInput struct {
	Email string `json:"email" binding:"required,email"`
	// ไม่มี min=8 ตรงนี้ — ความยาวขั้นต่ำมาจาก Password Policy เท่านั้น
	// (gin binding จะตอบ error เป็นข้อความดิบของ validator ซึ่งอ่านไม่รู้เรื่องและไม่ตรงกับ
	//  กฎที่หน้าจอแสดงอยู่ ถ้า admin ตั้ง min_length ไว้ 6)
	Password  string `json:"password" binding:"required"`
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	Profile   string `json:"profile"`
	// ข้อมูลโปรไฟล์เสริม — ฟอร์มสร้างผู้ใช้ไม่ได้เก็บ (ดูคอมเมนต์ใน entity.AppUser)
	PhoneNumber string `json:"phone_number"`
	Location    string `json:"location"`
	Position    string `json:"position"`
	AppRoleID   uint   `json:"app_role_id" binding:"required"`
}

type UpdateUserInput struct {
	Email       *string `json:"email"`
	Password    *string `json:"password"`
	FirstName   *string `json:"first_name"`
	LastName    *string `json:"last_name"`
	Profile     *string `json:"profile"`
	PhoneNumber *string `json:"phone_number"`
	Location    *string `json:"location"`
	Position    *string `json:"position"`
	AppRoleID   *uint   `json:"app_role_id"`
}

// GET /users/stats — lightweight endpoint for dashboard counts.
// Returns total user count and per-role breakdown without loading full user records.
func GetStats(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	var total int64
	if err := db.Model(&entity.AppUser{}).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count users"})
		return
	}

	type roleRow struct {
		Role  string `gorm:"column:role"`
		Count int64  `gorm:"column:count"`
	}
	var rows []roleRow
	db.Raw(`
		SELECT r.role, COUNT(u.id) AS count
		FROM app_users u
		JOIN app_roles r ON r.id = u.app_role_id
		WHERE u.deleted_at IS NULL
		GROUP BY r.role
	`).Scan(&rows)

	byRole := make(map[string]int64, len(rows))
	for _, r := range rows {
		byRole[r.Role] = r.Count
	}

	c.JSON(http.StatusOK, gin.H{
		"total":   total,
		"by_role": byRole,
	})
}

func CreateUser(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var input CreateUserInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db := config.DB()

	email := strings.ToLower(strings.TrimSpace(input.Email))
	password := strings.TrimSpace(input.Password)
	firstName := strings.TrimSpace(input.FirstName)
	lastName := strings.TrimSpace(input.LastName)
	profile := strings.TrimSpace(input.Profile)
	phoneNumber := strings.TrimSpace(input.PhoneNumber)
	location := strings.TrimSpace(input.Location)
	position := strings.TrimSpace(input.Position)

	if err := ValidateAvatar(profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing entity.AppUser
	if err := db.Where("email = ?", email).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check existing email"})
		return
	}

	var role entity.AppRole
	if err := db.First(&role, input.AppRoleID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role not found"})
		return
	}

	validateUser := entity.AppUser{
		Email: email, Password: password, FirstName: firstName, LastName: lastName,
		Profile: profile, PhoneNumber: phoneNumber, Location: location, Position: position,
		AppRoleID: input.AppRoleID,
	}
	if ok, err := govalidator.ValidateStruct(validateUser); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// รหัสผ่านของผู้ใช้ใหม่ต้องผ่าน Password Policy เดียวกับที่หน้า /admin/password-policy ตั้งไว้
	//
	// ของเดิม CreateUser **ไม่เคยเรียก ValidatePasswordPolicy เลย** — มันแฮชอะไรก็ได้ที่ส่งมา
	// ทั้งที่ UpdateUserByID และ UpdateUserIDByAdmin เรียกกันครบ ผลคือช่องโหว่ที่ตรงกันข้าม
	// กับที่ผู้ใช้เห็น: ตั้ง policy ให้ต้องมีตัวพิมพ์ใหญ่+ตัวเลข แล้ว admin สร้างบัญชีใหม่
	// ด้วยรหัส "aaaaaaaa" ได้สบาย ส่วนหน้าเว็บกลับบังคับกฎที่ hardcode ไว้เองคนละชุดกับ policy
	policy := services.GetPasswordPolicy(db)
	if err := services.ValidatePasswordPolicy(password, policy); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, err := platform.HashPassword(password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user := entity.AppUser{
		Email: email, Password: hashedPassword, FirstName: firstName, LastName: lastName,
		Profile: profile, PhoneNumber: phoneNumber, Location: location, Position: position,
		AppRoleID: input.AppRoleID,
	}
	if err := db.Create(&user).Error; err != nil {
		log.Printf("[ERROR] create user %q: %v", email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create the account"})
		return
	}

	go services.SavePasswordHistory(db, user.ID, hashedPassword)

	// Reuse already-fetched role — no extra DB query needed
	user.AppRole = &role

	c.JSON(http.StatusCreated, services.MapUserResponse(user))
}

// ListUser supports optional pagination: ?page=1&limit=20
// Omit limit (or limit=0) to return all users (backward-compatible).
//
// Admin-only: the whole user directory (names, emails, phone numbers) is admin data. A non-admin
// looking someone up goes through /search, which is scoped and read-only.
func ListUser(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	if page < 1 {
		page = 1
	}

	query := db.Preload("AppRole")
	if limit > 0 {
		query = query.Limit(limit).Offset((page - 1) * limit)
	}

	var users []entity.AppUser
	if err := query.Find(&users).Error; err != nil {
		log.Printf("[ERROR] list users: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the user list"})
		return
	}

	response := make([]services.UserResponse, 0, len(users))
	for _, u := range users {
		response = append(response, services.MapUserResponse(u))
	}
	c.JSON(http.StatusOK, response)
}

func ListUserByID(c *gin.Context) {
	id := c.Param("id")
	uid, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	// Only an admin, or the caller viewing their own record, may read this — otherwise any
	// signed-in account could page through every id and harvest the whole directory's PII.
	if !canViewUser(isAdmin(c), callerID(c), uint(uid)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you can only view your own account"})
		return
	}

	db := config.DB()
	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, uint(uid)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, services.MapUserResponse(user))
}

func UpdateUserByID(c *gin.Context) {
	id := c.Param("id")
	uid, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input UpdateUserInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// This endpoint serves two callers: an admin editing anyone (the Users page) and a user
	// editing their own profile (the Account page). editUserDecision encodes the rule.
	switch editUserDecision(isAdmin(c), callerID(c), uint(uid), input.AppRoleID != nil) {
	case editNotOwner:
		c.JSON(http.StatusForbidden, gin.H{"error": "you can only edit your own account"})
		return
	case editRoleForbidden:
		c.JSON(http.StatusForbidden, gin.H{"error": "only an administrator can change a user's role"})
		return
	}

	db := config.DB()
	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, uint(uid)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if input.Email == nil && input.Password == nil && input.FirstName == nil &&
		input.LastName == nil && input.Profile == nil && input.PhoneNumber == nil &&
		input.Location == nil && input.Position == nil && input.AppRoleID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields to update"})
		return
	}

	validateUser := entity.AppUser{
		Model: user.Model, Email: user.Email, Password: user.Password,
		FirstName: user.FirstName, LastName: user.LastName, Profile: user.Profile,
		PhoneNumber: user.PhoneNumber, Location: user.Location, Position: user.Position,
		AppRoleID: user.AppRoleID, AppRole: user.AppRole,
	}

	var newPlainPassword string

	if input.Email != nil {
		newEmail := strings.ToLower(strings.TrimSpace(*input.Email))
		var existing entity.AppUser
		err := db.Where("email = ? AND id <> ?", newEmail, user.ID).First(&existing).Error
		switch {
		case err == nil:
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check existing email"})
			return
		}
		validateUser.Email = newEmail
	}
	if input.FirstName != nil {
		validateUser.FirstName = strings.TrimSpace(*input.FirstName)
	}
	if input.LastName != nil {
		validateUser.LastName = strings.TrimSpace(*input.LastName)
	}
	if input.Profile != nil {
		validateUser.Profile = strings.TrimSpace(*input.Profile)
		if err := ValidateAvatar(validateUser.Profile); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	if input.PhoneNumber != nil {
		validateUser.PhoneNumber = strings.TrimSpace(*input.PhoneNumber)
	}
	if input.Location != nil {
		validateUser.Location = strings.TrimSpace(*input.Location)
	}
	if input.Position != nil {
		validateUser.Position = strings.TrimSpace(*input.Position)
	}

	var newRole *entity.AppRole
	if input.AppRoleID != nil {
		var role entity.AppRole
		if err := db.First(&role, *input.AppRoleID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "role not found"})
			return
		}
		validateUser.AppRoleID = *input.AppRoleID
		newRole = &role
	}
	if input.Password != nil {
		newPlainPassword = strings.TrimSpace(*input.Password)
		validateUser.Password = newPlainPassword
	}

	if ok, err := govalidator.ValidateStruct(validateUser); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Apply validated values back to user
	if input.Email != nil {
		user.Email = validateUser.Email
	}
	if input.FirstName != nil {
		user.FirstName = validateUser.FirstName
	}
	if input.LastName != nil {
		user.LastName = validateUser.LastName
	}
	if input.Profile != nil {
		user.Profile = validateUser.Profile
	}
	if input.PhoneNumber != nil {
		user.PhoneNumber = validateUser.PhoneNumber
	}
	if input.Location != nil {
		user.Location = validateUser.Location
	}
	if input.Position != nil {
		user.Position = validateUser.Position
	}
	if input.AppRoleID != nil {
		user.AppRoleID = validateUser.AppRoleID
	}
	var newHashedPassword string
	if input.Password != nil {
		policy := services.GetPasswordPolicy(db)
		if err := services.ValidatePasswordPolicy(newPlainPassword, policy); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if services.IsPasswordReused(db, user.ID, newPlainPassword) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be different from your current password"})
			return
		}
		hashed, err := platform.HashPassword(newPlainPassword)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
			return
		}
		user.Password = hashed
		newHashedPassword = hashed
		now := time.Now()
		user.PasswordChangedAt = &now
	}

	// Omit("AppRole") — without it, a role change is accepted, answered 200, and silently discarded.
	//
	// The row was loaded with Preload("AppRole"), so `user` carries the OLD role struct. GORM's
	// Save upserts a belongs-to association before writing the owner and then copies the
	// association's primary key into the owner's foreign key — so the stale user.AppRole put the
	// previous app_role_id straight back over the new one. The handler then set user.AppRole =
	// newRole for the response, which is why the body reported the new role while the database kept
	// the old one: the endpoint reported a change it had just thrown away.
	//
	// Omit names the association rather than clearing the field, because user.AppRole is still
	// needed below to answer with — and so the next person reading this sees the intent instead of
	// a mysterious `user.AppRole = nil`. There is no case here where this handler should be writing
	// the app_roles table at all; it assigns an existing role by id.
	if err := db.Omit("AppRole").Save(&user).Error; err != nil {
		log.Printf("[ERROR] update user %d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the account"})
		return
	}

	if newHashedPassword != "" {
		go services.SavePasswordHistory(db, user.ID, newHashedPassword)
	}

	// Use already-fetched role when it changed; otherwise keep existing AppRole
	if newRole != nil {
		user.AppRole = newRole
	}

	c.JSON(http.StatusOK, services.MapUserResponse(user))
}

func DeleteUserByID(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id := c.Param("id")
	uid, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	deletedByID := callerID(c)
	if deletedByID == uint(uid) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete your own account"})
		return
	}

	db := config.DB()
	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, uint(uid)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	// Never let the final administrator be removed — there is no way to appoint a new one
	// afterwards, so the system would be left unmanageable.
	if ok, err := hasOtherAdmin(db, []uint{uint(uid)}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify admin count"})
		return
	} else if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete the last administrator"})
		return
	}

	roleName := ""
	if user.AppRole != nil {
		roleName = user.AppRole.Role
	}

	tx := db.Begin()
	bk := entity.Backup{
		OriginalID: user.ID, Email: user.Email, Password: user.Password,
		FirstName: user.FirstName, LastName: user.LastName, Profile: user.Profile,
		PhoneNumber: user.PhoneNumber, Location: user.Location, Position: user.Position,
		RoleName: roleName, AppRoleID: user.AppRoleID, DeletedByID: deletedByID,
	}
	if err := tx.Create(&bk).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create backup"})
		return
	}
	if err := tx.Delete(&entity.AppUser{}, uint(uid)).Error; err != nil {
		tx.Rollback()
		log.Printf("[ERROR] delete user %d: %v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete the account"})
		return
	}
	tx.Commit()

	// Their firewall access goes with them, and it goes for real — a soft-deleted grant still
	// answers "yes" to UserCanAccessDevice, and the unique index it sits under does not include
	// deleted_at. See entity.UserDeviceAccess.
	services.PurgeDeviceGrantsForUser(db, uint(uid))

	c.JSON(http.StatusOK, gin.H{"message": "user deleted successfully"})
}

type RoleResponse struct {
	ID   uint   `json:"id"`
	Role string `json:"role"`
}

type UpdateUserByAdminInput struct {
	Email       *string `json:"email"`
	Password    *string `json:"password"`
	FirstName   *string `json:"first_name"`
	LastName    *string `json:"last_name"`
	Profile     *string `json:"profile"`
	PhoneNumber *string `json:"phone_number"`
	Location    *string `json:"location"`
	Position    *string `json:"position"`
	AppRoleID   *uint   `json:"app_role_id"`
}

func ListRoles(c *gin.Context) {
	var roles []entity.AppRole
	db := config.DB()
	if err := db.Order("id asc").Find(&roles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list roles"})
		return
	}
	response := make([]RoleResponse, 0, len(roles))
	for _, role := range roles {
		response = append(response, RoleResponse{ID: role.ID, Role: role.Role})
	}
	c.JSON(http.StatusOK, response)
}

func UpdateUserIDByAdmin(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id := c.Param("id")
	uid, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input UpdateUserByAdminInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db := config.DB()
	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, uint(uid)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if input.Email == nil && input.Password == nil && input.FirstName == nil &&
		input.LastName == nil && input.Profile == nil && input.PhoneNumber == nil &&
		input.Location == nil && input.Position == nil && input.AppRoleID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields to update"})
		return
	}

	validateUser := entity.AppUser{
		Model: user.Model, Email: user.Email, Password: user.Password,
		FirstName: user.FirstName, LastName: user.LastName, Profile: user.Profile,
		PhoneNumber: user.PhoneNumber, Location: user.Location, Position: user.Position,
		AppRoleID: user.AppRoleID, AppRole: user.AppRole,
	}

	updates := map[string]interface{}{}
	var newPlainPassword string
	var newRole *entity.AppRole

	if input.Email != nil {
		newEmail := strings.ToLower(strings.TrimSpace(*input.Email))
		var existing entity.AppUser
		err := db.Where("email = ? AND id <> ?", newEmail, user.ID).First(&existing).Error
		switch {
		case err == nil:
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check existing email"})
			return
		}
		validateUser.Email = newEmail
		updates["Email"] = newEmail
	}
	if input.FirstName != nil {
		validateUser.FirstName = strings.TrimSpace(*input.FirstName)
		updates["FirstName"] = validateUser.FirstName
	}
	if input.LastName != nil {
		validateUser.LastName = strings.TrimSpace(*input.LastName)
		updates["LastName"] = validateUser.LastName
	}
	if input.Profile != nil {
		validateUser.Profile = strings.TrimSpace(*input.Profile)
		if err := ValidateAvatar(validateUser.Profile); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updates["Profile"] = validateUser.Profile
	}
	if input.PhoneNumber != nil {
		validateUser.PhoneNumber = strings.TrimSpace(*input.PhoneNumber)
		updates["PhoneNumber"] = validateUser.PhoneNumber
	}
	if input.Location != nil {
		validateUser.Location = strings.TrimSpace(*input.Location)
		updates["Location"] = validateUser.Location
	}
	if input.Position != nil {
		validateUser.Position = strings.TrimSpace(*input.Position)
		updates["Position"] = validateUser.Position
	}
	if input.AppRoleID != nil {
		var role entity.AppRole
		if err := db.First(&role, *input.AppRoleID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "role not found"})
			return
		}
		// Demoting the last remaining admin would leave user management unreachable.
		demotingAdmin := user.AppRole != nil && user.AppRole.Role == adminRoleName && role.Role != adminRoleName
		if demotingAdmin {
			if ok, err := hasOtherAdmin(db, []uint{user.ID}); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify admin count"})
				return
			} else if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the last administrator's role"})
				return
			}
		}
		validateUser.AppRoleID = *input.AppRoleID
		updates["AppRoleID"] = *input.AppRoleID
		newRole = &role
	}
	if input.Password != nil {
		newPlainPassword = strings.TrimSpace(*input.Password)
		validateUser.Password = newPlainPassword
	}

	if ok, err := govalidator.ValidateStruct(validateUser); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Password != nil {
		policy := services.GetPasswordPolicy(db)
		if err := services.ValidatePasswordPolicy(newPlainPassword, policy); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		hashed, err := platform.HashPassword(newPlainPassword)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
			return
		}
		updates["Password"] = hashed
		now := time.Now()
		updates["PasswordChangedAt"] = &now
	}

	if err := db.Model(&entity.AppUser{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
		log.Printf("[ERROR] admin update of user %d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the account"})
		return
	}

	// Apply updates to in-memory struct to avoid an extra DB query
	if v, ok := updates["Email"].(string); ok {
		user.Email = v
	}
	if v, ok := updates["FirstName"].(string); ok {
		user.FirstName = v
	}
	if v, ok := updates["LastName"].(string); ok {
		user.LastName = v
	}
	if v, ok := updates["Profile"].(string); ok {
		user.Profile = v
	}
	if v, ok := updates["PhoneNumber"].(string); ok {
		user.PhoneNumber = v
	}
	if v, ok := updates["Location"].(string); ok {
		user.Location = v
	}
	if v, ok := updates["Position"].(string); ok {
		user.Position = v
	}
	if newRole != nil {
		user.AppRole = newRole
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "update user by admin success",
		"data":    services.MapUserResponse(user),
	})
}

type EmailAndPhoneNumberResponse struct {
	ID          uint   `json:"id"`
	Email       string `json:"email"`
	PhoneNumber string `json:"phone_number"`
}

// ── Bulk Actions ──────────────────────────────────────────────────────────────

type BulkDeleteInput struct {
	IDs []uint `json:"ids" binding:"required"`
}

func BulkDeleteUsers(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var input BulkDeleteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(input.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no users selected"})
		return
	}

	callerUID := callerID(c)
	for _, id := range input.IDs {
		if id == callerUID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete your own account"})
			return
		}
	}

	db := config.DB()

	// Refuse a delete that would take out every admin at once (see hasOtherAdmin).
	if ok, err := hasOtherAdmin(db, input.IDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify admin count"})
		return
	} else if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete the last administrator"})
		return
	}

	var users []entity.AppUser
	if err := db.Preload("AppRole").Where("id IN ?", input.IDs).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch users"})
		return
	}
	if len(users) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no matching users found"})
		return
	}

	// Build all backups in memory then batch-insert in one query
	backups := make([]entity.Backup, 0, len(users))
	for _, u := range users {
		roleName := ""
		if u.AppRole != nil {
			roleName = u.AppRole.Role
		}
		backups = append(backups, entity.Backup{
			OriginalID: u.ID, Email: u.Email, Password: u.Password,
			FirstName: u.FirstName, LastName: u.LastName, Profile: u.Profile,
			PhoneNumber: u.PhoneNumber, Location: u.Location, Position: u.Position,
			RoleName: roleName, AppRoleID: u.AppRoleID, DeletedByID: callerUID,
		})
	}

	tx := db.Begin()
	if err := tx.CreateInBatches(backups, 100).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create backups"})
		return
	}
	if err := tx.Where("id IN ?", input.IDs).Delete(&entity.AppUser{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete users"})
		return
	}
	tx.Commit()

	// Same as the single delete: the device grants are hard-deleted alongside the accounts.
	for _, u := range users {
		services.PurgeDeviceGrantsForUser(db, u.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("deleted %d users", len(users)),
		"count":   len(users),
	})
}

type BulkChangeRoleInput struct {
	IDs       []uint `json:"ids" binding:"required"`
	AppRoleID uint   `json:"app_role_id" binding:"required"`
}

func BulkChangeRole(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var input BulkChangeRoleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(input.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no users selected"})
		return
	}

	db := config.DB()
	var role entity.AppRole
	if err := db.First(&role, input.AppRoleID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role not found"})
		return
	}

	// Reassigning admins to a non-admin role can empty the admin pool. Only worth checking when
	// the target role itself is not admin — promoting to admin never removes one.
	if role.Role != adminRoleName {
		if ok, err := hasOtherAdmin(db, input.IDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify admin count"})
			return
		} else if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the last administrator's role"})
			return
		}
	}

	result := db.Model(&entity.AppUser{}).Where("id IN ?", input.IDs).Update("app_role_id", input.AppRoleID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update roles"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("changed role to %s for %d users", role.Role, result.RowsAffected),
		"count":   result.RowsAffected,
	})
}

// ListEmailAndPhoneNumber returns every user's address and phone number.
//
// Admin-only, like every other handler in this file that reads across accounts. It is called from
// one place — the Create/Edit User dialog, which uses it to catch a duplicate address or phone
// before submitting — and that dialog is already admin-only.
//
// It was registered on the PUBLIC otp group until now, so an unauthenticated GET returned the
// whole table: a ready-made list of valid login addresses, plus a phone number for each, from the
// login page. ListUser directly above has always been gated; this was the same data without the
// gate.
func ListEmailAndPhoneNumber(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()
	var users []entity.AppUser
	if err := db.Select("id, email, phone_number").Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch email and phone number"})
		return
	}
	result := make([]EmailAndPhoneNumberResponse, 0, len(users))
	for _, u := range users {
		result = append(result, EmailAndPhoneNumberResponse{ID: u.ID, Email: u.Email, PhoneNumber: u.PhoneNumber})
	}
	c.JSON(http.StatusOK, result)
}

type ThemePreferenceInput struct {
	ThemeMode  string `json:"theme_mode"`
	ThemeColor string `json:"theme_color"`
}

func UpdateThemePreference(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
		return
	}

	var input ThemePreferenceInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]any{}
	if input.ThemeMode != "" {
		valid := map[string]bool{"Light": true, "Dark": true, "System": true}
		if !valid[input.ThemeMode] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid theme_mode"})
			return
		}
		updates["theme_mode"] = input.ThemeMode
	}
	if input.ThemeColor != "" {
		if !hexColorRe.MatchString(input.ThemeColor) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid theme_color (must be hex e.g. #10B981)"})
			return
		}
		updates["theme_color"] = input.ThemeColor
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nothing to update"})
		return
	}

	db := config.DB()
	if err := db.Model(&entity.AppUser{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update theme preference"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "theme preference updated"})
}
