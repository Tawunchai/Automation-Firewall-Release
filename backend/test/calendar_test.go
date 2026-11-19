package unit

import (
	"testing"
	"time"

	. "github.com/onsi/gomega"

	"github.com/asaskevich/govalidator"
	"network_automation/entity"
)

func validCalendarEvent() entity.CalendarEvent {
	now := time.Now()
	return entity.CalendarEvent{
		Title:     "Team Meeting",
		StartDate: now,
		EndDate:   now.Add(1 * time.Hour),
		Category:  "office",
		Color:     "#7C3AED",
		AppUserID: 1,
	}
}

func TestCalendarEventValidInput(t *testing.T) {
	g := NewGomegaWithT(t)
	ok, err := govalidator.ValidateStruct(validCalendarEvent())
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}

func TestCalendarEventTitleRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	ev := validCalendarEvent()
	ev.Title = ""
	ok, err := govalidator.ValidateStruct(ev)
	g.Expect(ok).To(BeFalse())
	g.Expect(err.Error()).To(ContainSubstring("Title is required"))
}

func TestCalendarEventCategoryRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	ev := validCalendarEvent()
	ev.Category = ""
	ok, err := govalidator.ValidateStruct(ev)
	g.Expect(ok).To(BeFalse())
	g.Expect(err.Error()).To(ContainSubstring("Category is required"))
}

func TestCalendarEventCategoryInvalid(t *testing.T) {
	g := NewGomegaWithT(t)
	ev := validCalendarEvent()
	ev.Category = "unknown_category"
	ok, err := govalidator.ValidateStruct(ev)
	g.Expect(ok).To(BeFalse())
	g.Expect(err.Error()).To(ContainSubstring("Invalid category"))
}

func TestCalendarEventAllValidCategories(t *testing.T) {
	g := NewGomegaWithT(t)
	for _, cat := range []string{"calendar", "birthday", "holiday", "office", "other", "festival", "timeline"} {
		ev := validCalendarEvent()
		ev.Category = cat
		ok, err := govalidator.ValidateStruct(ev)
		g.Expect(ok).To(BeTrue(), "expected category %s to be valid", cat)
		g.Expect(err).To(BeNil())
	}
}

func TestCalendarEventAppUserIDRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	ev := validCalendarEvent()
	ev.AppUserID = 0
	ok, err := govalidator.ValidateStruct(ev)
	g.Expect(ok).To(BeFalse())
	g.Expect(err.Error()).To(ContainSubstring("AppUserID is required"))
}

func TestCalendarEventTitleTooLong(t *testing.T) {
	g := NewGomegaWithT(t)
	ev := validCalendarEvent()
	for i := 0; i < 256; i++ {
		ev.Title += "x"
	}
	ok, err := govalidator.ValidateStruct(ev)
	g.Expect(ok).To(BeFalse())
	g.Expect(err.Error()).To(ContainSubstring("Title must be between"))
}
