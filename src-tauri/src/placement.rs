//! Pure placement rules/geometry. OS access is confined to desktop platform modules.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    TopLeft,
    Top,
    TopRight,
    Left,
    #[default]
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

impl Anchor {
    pub fn fractions(self) -> (f64, f64) {
        match self {
            Self::TopLeft => (0.0, 0.0),
            Self::Top => (0.5, 0.0),
            Self::TopRight => (1.0, 0.0),
            Self::Left => (0.0, 0.5),
            Self::Center => (0.5, 0.5),
            Self::Right => (1.0, 0.5),
            Self::BottomLeft => (0.0, 1.0),
            Self::Bottom => (0.5, 1.0),
            Self::BottomRight => (1.0, 1.0),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementRule {
    pub anchor: Anchor,
    pub offset_x: f64,
    pub offset_y: f64,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationOverride {
    pub application_id: String,
    pub application_name: String,
    pub rule: PlacementRule,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementSettings {
    pub enabled: bool,
    pub default: PlacementRule,
    pub overrides: Vec<ApplicationOverride>,
}

impl Default for PlacementSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            default: PlacementRule {
                width: Some(640.0),
                height: Some(480.0),
                ..Default::default()
            },
            overrides: Vec::new(),
        }
    }
}

impl PlacementSettings {
    pub fn rule_for(&self, application_id: Option<&str>) -> PlacementRule {
        self.overrides
            .iter()
            .find(|o| {
                application_id.is_some_and(|id| {
                    if cfg!(windows) {
                        o.application_id.eq_ignore_ascii_case(id)
                    } else {
                        o.application_id == id
                    }
                })
            })
            .map(|o| PlacementRule {
                width: o.rule.width.or(self.default.width),
                height: o.rule.height.or(self.default.height),
                ..o.rule.clone()
            })
            .unwrap_or_else(|| self.default.clone())
    }
    pub fn validate(&self) -> Result<(), String> {
        let valid_rule = |r: &PlacementRule| {
            [r.offset_x, r.offset_y]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 4096.0)
                && r.width
                    .is_none_or(|v| v.is_finite() && (560.0..=4096.0).contains(&v))
                && r.height
                    .is_none_or(|v| v.is_finite() && (420.0..=4096.0).contains(&v))
        };
        if !valid_rule(&self.default) || self.overrides.len() > 100 {
            return Err("Invalid default placement: width must be 560–4096, height 420–4096, offsets within ±4096 points; at most 100 overrides.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for o in &self.overrides {
            let key = if cfg!(windows) {
                o.application_id.to_lowercase()
            } else {
                o.application_id.clone()
            };
            if o.application_id.trim().is_empty()
                || o.application_id.len() > 4096
                || o.application_id.contains('\0')
                || o.application_name.trim().is_empty()
                || o.application_name.len() > 512
                || !ids.insert(key)
                || !valid_rule(&o.rule)
            {
                return Err("Invalid or duplicate application placement override. Width must be 560–4096, height 420–4096, offsets within ±4096 points.".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
    fn intersection(self, other: Self) -> f64 {
        ((self.x + self.width).min(other.x + other.width) - self.x.max(other.x)).max(0.0)
            * ((self.y + self.height).min(other.y + other.height) - self.y.max(other.y)).max(0.0)
    }
}

/// Coordinates and window size use the platform's native desktop units. `scale`
/// converts logical user offsets into those units (1 on macOS; DPI/96 on Windows).
pub fn anchored(
    reference: Rect,
    size: (f64, f64),
    work: Rect,
    rule: &PlacementRule,
    scale: f64,
) -> Result<Rect, String> {
    let width = rule.width.map_or(size.0, |width| width * scale);
    let height = rule.height.map_or(size.1, |height| height * scale);
    if !reference.valid()
        || !work.valid()
        || !scale.is_finite()
        || scale <= 0.0
        || ![width, height, rule.offset_x, rule.offset_y]
            .iter()
            .all(|v| v.is_finite())
        || width <= 0.0
        || height <= 0.0
    {
        return Err("Invalid placement geometry.".into());
    }
    let width = width.min(work.width);
    let height = height.min(work.height);
    let (ax, ay) = rule.anchor.fractions();
    Ok(Rect {
        x: (reference.x + (reference.width - width) * ax + rule.offset_x * scale)
            .clamp(work.x, work.x + work.width - width),
        y: (reference.y + (reference.height - height) * ay + rule.offset_y * scale)
            .clamp(work.y, work.y + work.height - height),
        width,
        height,
    })
}

/// Largest overlap wins for windows spanning displays; entirely off-screen windows
/// use the nearest work area. No pointer-display heuristic is used.
pub fn work_area_for(reference: Rect, areas: &[Rect]) -> Option<Rect> {
    areas.iter().copied().filter(|r| r.valid()).max_by(|a, b| {
        let overlap = reference
            .intersection(*a)
            .total_cmp(&reference.intersection(*b));
        if overlap != std::cmp::Ordering::Equal {
            return overlap;
        }
        let distance = |r: Rect| {
            (reference.x + reference.width / 2.0 - r.x - r.width / 2.0).powi(2)
                + (reference.y + reference.height / 2.0 - r.y - r.height / 2.0).powi(2)
        };
        distance(*b).total_cmp(&distance(*a))
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Application {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementContext {
    pub applications: Vec<Application>,
    pub last_application: Option<Application>,
    pub accessibility_required: bool,
    pub accessibility_granted: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct FocusTarget {
    pub is_ramble: bool,
    pub application: Option<Application>,
    pub window: Option<Rect>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn nine_anchors_align_the_same_point_on_both_windows() {
        for anchor in [
            Anchor::TopLeft,
            Anchor::Top,
            Anchor::TopRight,
            Anchor::Left,
            Anchor::Center,
            Anchor::Right,
            Anchor::BottomLeft,
            Anchor::Bottom,
            Anchor::BottomRight,
        ] {
            let r = anchored(
                rect(100.0, 100.0, 1000.0, 800.0),
                (400.0, 300.0),
                rect(0.0, 0.0, 2000.0, 2000.0),
                &PlacementRule {
                    anchor,
                    ..Default::default()
                },
                1.0,
            )
            .unwrap();
            let (x, y) = anchor.fractions();
            assert_eq!(r.x, 100.0 + 600.0 * x);
            assert_eq!(r.y, 100.0 + 500.0 * y);
        }
    }
    #[test]
    fn offsets_scale_and_clamp_to_negative_origin_work_areas() {
        let rule = PlacementRule {
            anchor: Anchor::BottomRight,
            offset_x: -20.0,
            offset_y: 10.0,
            ..Default::default()
        };
        let r = anchored(
            rect(-1900.0, 0.0, 1200.0, 900.0),
            (800.0, 600.0),
            rect(-1920.0, 30.0, 1920.0, 1000.0),
            &rule,
            2.0,
        )
        .unwrap();
        assert_eq!(r, rect(-1540.0, 320.0, 800.0, 600.0));
        let r = anchored(
            rect(-4000.0, -1000.0, 200.0, 100.0),
            (2000.0, 2000.0),
            rect(-1920.0, 30.0, 1920.0, 1000.0),
            &rule,
            1.0,
        )
        .unwrap();
        assert_eq!(r, rect(-1920.0, 30.0, 1920.0, 1000.0));
    }
    #[test]
    fn display_selection_uses_window_overlap_not_pointer_and_handles_offscreen() {
        let screens = [
            rect(-1920.0, 0.0, 1920.0, 1080.0),
            rect(0.0, 0.0, 2560.0, 1440.0),
        ];
        assert_eq!(
            work_area_for(rect(-1000.0, 20.0, 800.0, 700.0), &screens),
            Some(screens[0])
        );
        assert_eq!(
            work_area_for(rect(5000.0, 20.0, 800.0, 700.0), &screens),
            Some(screens[1])
        );
    }
    #[test]
    fn size_overrides_inherit_each_axis_then_scale_anchor_and_clamp() {
        let mut settings = PlacementSettings::default();
        settings.default.width = Some(800.0);
        settings.default.height = Some(600.0);
        settings.overrides.push(ApplicationOverride {
            application_id: "editor".into(),
            application_name: "Editor".into(),
            rule: PlacementRule {
                anchor: Anchor::BottomRight,
                width: Some(960.0),
                ..Default::default()
            },
        });
        let rule = settings.rule_for(Some("editor"));
        assert_eq!((rule.width, rule.height), (Some(960.0), Some(600.0)));
        assert_eq!(settings.rule_for(Some("other")), settings.default);
        let r = anchored(
            rect(0.0, 0.0, 2400.0, 1600.0),
            (640.0, 480.0),
            rect(0.0, 0.0, 3000.0, 2000.0),
            &rule,
            2.0,
        )
        .unwrap();
        assert_eq!(r, rect(480.0, 400.0, 1920.0, 1200.0));
        let r = anchored(
            rect(0.0, 0.0, 2400.0, 1600.0),
            (640.0, 480.0),
            rect(0.0, 0.0, 1000.0, 800.0),
            &rule,
            2.0,
        )
        .unwrap();
        assert_eq!(r, rect(0.0, 0.0, 1000.0, 800.0));
        settings.default.height = None;
        let rule = settings.rule_for(Some("editor"));
        let r = anchored(
            rect(0.0, 0.0, 2400.0, 1600.0),
            (640.0, 500.0),
            rect(0.0, 0.0, 3000.0, 2000.0),
            &rule,
            1.0,
        )
        .unwrap();
        assert_eq!((r.width, r.height), (960.0, 500.0));
        let unchanged = PlacementRule {
            anchor: Anchor::TopLeft,
            ..Default::default()
        };
        let r = anchored(
            rect(10.0, 20.0, 700.0, 500.0),
            (700.0, 500.0),
            rect(0.0, 0.0, 3000.0, 2000.0),
            &unchanged,
            1.0,
        )
        .unwrap();
        assert_eq!(r, rect(10.0, 20.0, 700.0, 500.0));
    }

    #[test]
    fn dimension_limits_reject_invalid_sizes_and_allow_blank_inheritance() {
        let mut settings = PlacementSettings::default();
        for value in [f64::NAN, f64::INFINITY, -1.0, 559.0, 4097.0] {
            settings.default.width = Some(value);
            assert!(settings.validate().is_err());
        }
        settings.default.width = None;
        for value in [f64::NAN, f64::NEG_INFINITY, 0.0, 419.0, 4097.0] {
            settings.default.height = Some(value);
            assert!(settings.validate().is_err());
        }
        settings.default.height = None;
        settings.validate().unwrap();
        settings.default.width = Some(560.0);
        settings.default.height = Some(420.0);
        settings.validate().unwrap();
        settings.default.width = Some(4096.0);
        settings.default.height = Some(4096.0);
        settings.validate().unwrap();
    }

    #[test]
    fn override_selection_and_validation_are_deterministic() {
        let mut p = PlacementSettings::default();
        let rule = PlacementRule {
            anchor: Anchor::TopRight,
            offset_x: -24.0,
            offset_y: 24.0,
            ..Default::default()
        };
        p.overrides.push(ApplicationOverride {
            application_id: "com.example.editor".into(),
            application_name: "Editor".into(),
            rule: rule.clone(),
        });
        let resolved = p.rule_for(Some("com.example.editor"));
        assert_eq!(resolved.anchor, rule.anchor);
        assert_eq!(resolved.width, p.default.width);
        assert_eq!(p.rule_for(None), p.default);
        p.validate().unwrap();
        p.overrides.push(p.overrides[0].clone());
        assert!(p.validate().is_err());
        p.overrides.pop();
        p.default.offset_x = f64::NAN;
        assert!(p.validate().is_err());
    }
}
