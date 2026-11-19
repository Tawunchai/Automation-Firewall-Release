// Package ai — AI Assistant: แปลงคำขอภาษาธรรมดา → คำสั่ง config อุปกรณ์ (Claude API)
// คืนแค่ "คำแนะนำ" (commands/explanation/warning) ให้ผู้ใช้ตรวจสอบ
// การ apply จริงทำผ่าน REST device-proxy (เร็ว) หรือ POST /config-deploys เป็น fallback
package ai

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// imageInput is one optional attachment on the CURRENT turn. data is standard base64 with NO
// "data:" prefix.
type imageInput struct {
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type generateRequest struct {
	DeviceID uint          `json:"device_id" binding:"required"`
	Prompt   string        `json:"prompt" binding:"required"`
	History  []chatMessage `json:"history"`
	Images   []imageInput  `json:"images"`
}

// Image attachment limits — enforced in validateImages. Images apply to the current prompt only.
const (
	maxImages     = 4
	maxImageBytes = 4 * 1024 * 1024 // 4 MiB, the per-image decoded-size ceiling
)

// allowedImageMediaTypes is the exact set Anthropic's Messages API accepts for base64 image blocks.
var allowedImageMediaTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
}

// validateImages checks the optional image attachments against the wire contract and converts them
// to the service type. It returns a 400-worthy error (safe to show the client) on any violation;
// an empty/absent list is valid and yields nil.
func validateImages(imgs []imageInput) ([]services.ImageInput, error) {
	if len(imgs) == 0 {
		return nil, nil
	}
	if len(imgs) > maxImages {
		return nil, fmt.Errorf("at most %d image(s) can be attached", maxImages)
	}
	out := make([]services.ImageInput, 0, len(imgs))
	for i, img := range imgs {
		if !allowedImageMediaTypes[img.MediaType] {
			return nil, fmt.Errorf("image %d: unsupported media_type (only image/png, image/jpeg, image/gif, image/webp)", i+1)
		}
		if img.Data == "" {
			return nil, fmt.Errorf("image %d: no image data (data is empty)", i+1)
		}
		decoded, err := base64.StdEncoding.DecodeString(img.Data)
		if err != nil {
			return nil, fmt.Errorf("image %d: the base64 data is not valid", i+1)
		}
		if len(decoded) > maxImageBytes {
			return nil, fmt.Errorf("image %d: too large (at most %d MiB)", i+1, maxImageBytes/(1024*1024))
		}
		out = append(out, services.ImageInput{MediaType: img.MediaType, Data: img.Data})
	}
	return out, nil
}

// validateGenerate runs the shared guards for both the buffered and the streaming endpoint and
// returns the device + normalised history. It writes the error response itself; ok=false means the
// caller must return immediately (nothing has been written to the body yet, so an SSE handler is
// still free to fall back to a normal JSON error at this point).
func validateGenerate(c *gin.Context) (req generateRequest, device entity.NetworkDevice, login services.DeviceLogin, history []services.ChatMessage, images []services.ImageInput, ok bool) {
	if services.AnthropicAPIKey() == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "the AI assistant is not configured (no ANTHROPIC_API_KEY)"})
		return
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Prompt) > maxPromptLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("the request is too long (at most %d characters)", maxPromptLen)})
		return
	}
	if len(req.History) > maxHistoryItems {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("the chat history is too long (at most %d messages)", maxHistoryItems)})
		return
	}
	for _, h := range req.History {
		if len(h.Content) > maxHistoryContentLen {
			c.JSON(http.StatusBadRequest, gin.H{"error": "a message in the chat history is too long"})
			return
		}
	}
	images, imgErr := validateImages(req.Images)
	if imgErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": imgErr.Error()})
		return
	}
	if err := config.DB().First(&device, req.DeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	// Per-user device access. This route takes a device_id straight from the body and was the one
	// device-reaching endpoint outside the /policy/device/… prefix that never checked it.
	// 404, not 403, for the same reason as everywhere else.
	uid := c.GetUint("user_id")
	if !services.UserCanAccessDevice(config.DB(), uid, c.GetString("user_role") == "admin", device.ID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	// The live device snapshot the prompt is built from is read as the PERSON who is asking, so the
	// firewall's event log names them rather than a shared account.
	var err error
	login, err = services.ResolveDeviceLogin(config.DB(), uid, &device)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	history = make([]services.ChatMessage, 0, len(req.History))
	for _, h := range req.History {
		if (h.Role != "user" && h.Role != "assistant") || h.Content == "" {
			continue
		}
		history = append(history, services.ChatMessage{Role: h.Role, Content: h.Content})
	}
	return req, device, login, history, images, true
}

// POST /ai/generate-config/stream — same contract as /ai/generate-config, but the answer is pushed
// as Server-Sent Events while the model writes it instead of after it finishes.
//
// The model needs ~50s to write a full multi-object proposal (it generates ~60 tokens/s and the
// answer is ~3,000 tokens). Buffered, that is 50 seconds of blank spinner; streamed, the first
// text lands in a couple of seconds and the rest fills in as it is produced.
//
// Events:
//
//	status  {"phase":"device"|"model"}  — where we are (reading the FortiGate / model writing)
//	delta   {"explanation":"…","cli":"…"} — text to APPEND (both fields are incremental)
//	done    {"data":{…ConfigSuggestion}}  — the validated, deployable result
//	error   {"error":"…"}
//
// ⚠️ The `delta` text is a PREVIEW. Only the `done` payload has been through the signature-id
// validation and profile de-duplication, so it — never the accumulated deltas — is what the
// wizards and the deploy path must use.
func GenerateConfigStream(c *gin.Context) {
	req, device, login, history, images, ok := validateGenerate(c)
	if !ok {
		return
	}
	userID := c.GetUint("user_id")

	h := c.Writer.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // nginx must not buffer this (frontend proxies /api)
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	ctx := c.Request.Context()
	send := func(event string, payload any) {
		if ctx.Err() != nil {
			return // client navigated away — stop writing
		}
		b, err := json.Marshal(payload)
		if err != nil {
			return
		}
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		c.Writer.Flush()
	}

	// Tell the UI we are alive before the FortiGate snapshot (a second or two of silence otherwise).
	send("status", gin.H{"phase": "device"})

	modelStarted := false
	suggestion, err := services.GenerateDeviceConfigStream(c.Request.Context(), &device, login, req.Prompt, history, images,
		func(d services.AIStreamDelta) {
			if !modelStarted {
				modelStarted = true
				send("status", gin.H{"phase": "model"})
			}
			send("delta", gin.H{"explanation": d.Explanation, "cli": d.CLI})
		})
	if err != nil {
		log.Printf("[ai] generate-config(stream) failed (device_id=%d user=%s): %v",
			req.DeviceID, c.GetString("user_email"), err)
		services.LogActivity(config.DB(), userID, fmt.Sprintf("ai_generate_config_failed: device_id=%d", req.DeviceID))
		send("error", gin.H{"error": "the AI assistant could not be reached — please try again"})
		return
	}
	if suggestion.Mode == "" {
		suggestion.Mode = "config"
	}

	services.LogActivity(config.DB(), userID, fmt.Sprintf(
		"ai_generate_config: device_id=%d mode=%s commands=%d", req.DeviceID, suggestion.Mode, len(suggestion.Commands),
	))
	send("done", gin.H{"data": suggestion})
}

// ขีดจำกัดขนาด request — ป้องกันการยิง prompt ขนาดใหญ่ผิดปกติเข้า Anthropic API (ค่าใช้จ่าย/abuse)
const (
	maxPromptLen         = 4000 // ขยายรับ prompt ที่ยาวขึ้น
	maxHistoryItems      = 20
	maxHistoryContentLen = 6000 // ขยายรับ AI explanation ที่ยาวขึ้น
)

// ── Diagnose job failure ──────────────────────────────────────────────────────

type diagnoseJobRequest struct {
	JobID uint `json:"job_id" binding:"required"`
}

// jobByID is the row lookup DiagnoseJob makes before it can tell WHICH device the request is
// about, and therefore before it can check whether the caller may have it.
//
// They are variables for the same reason loadBackupWithDevice is one in controller/automationjob:
// config.DB() is a package-level handle with no test seam, so the access guard that follows each
// of them could not otherwise be exercised without a live Postgres. The guard in the tests is the
// real one; only the row is supplied.
var jobByID = func(id uint) (entity.AutomationJob, bool) {
	var job entity.AutomationJob
	if err := config.DB().First(&job, id).Error; err != nil {
		return job, false
	}
	return job, true
}

// mayReachDevice is the per-user device access check DiagnoseJob was missing, in the same shape
// validateGenerate already uses it. 404, never 403 — see services/deviceaccess.go.
func mayReachDevice(c *gin.Context, deviceID uint) bool {
	return services.UserCanAccessDevice(config.DB(), c.GetUint("user_id"),
		c.GetString("user_role") == "admin", deviceID)
}

// POST /ai/diagnose-job — ทุก login user เรียกได้ (วิเคราะห์งานที่ FAILED ด้วย AI)
func DiagnoseJob(c *gin.Context) {
	if services.AnthropicAPIKey() == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "the AI assistant is not configured (no ANTHROPIC_API_KEY)"})
		return
	}

	var req diagnoseJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	job, found := jobByID(req.JobID)
	// The job id comes straight from the body and job ids are sequential. What goes to Anthropic is
	// the device's name, its management IP and the job's result text (which carries the failure —
	// authentication errors, SSH banners), and the analysis comes back to the caller. Resolve the
	// device off the job row and apply the same grant check GenerateConfig does, before any of that
	// leaves the building. A missing job and an ungranted one answer identically, so the id space
	// cannot be walked.
	if !found || !mayReachDevice(c, job.NetworkDeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	if job.Status != "FAILED" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only a job with status FAILED can be analysed"})
		return
	}

	var device *entity.NetworkDevice
	var d entity.NetworkDevice
	if err := config.DB().First(&d, job.NetworkDeviceID).Error; err == nil {
		device = &d
	}

	userID := c.GetUint("user_id")

	result, err := services.DiagnoseJobFailure(c.Request.Context(), &job, device)
	if err != nil {
		log.Printf("[ai] diagnose-job failed (job_id=%d user=%s): %v", req.JobID, c.GetString("user_email"), err)
		services.LogActivity(config.DB(), userID, fmt.Sprintf("ai_diagnose_job_failed: job_id=%d", req.JobID))
		c.JSON(http.StatusBadGateway, gin.H{"error": "the AI assistant could not be reached — please try again"})
		return
	}

	services.LogActivity(config.DB(), userID, fmt.Sprintf("ai_diagnose_job: job_id=%d severity=%s", req.JobID, result.Severity))
	c.JSON(http.StatusOK, gin.H{"data": result})
}
