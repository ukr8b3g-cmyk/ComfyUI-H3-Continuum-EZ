from types import MappingProxyType

import pytest
import torch

from h3ezstudio.vendor.continuum.layout_adapter import (
    LayoutCompatibilityError,
    normalize_condition_latents,
    preflight_packed_layout,
)


class FakePackedLayout:
    """Small Core-compatible row topology used by contract tests."""

    def __init__(
        self,
        text_len,
        latent_t,
        latent_h,
        latent_w,
        audio_t,
        keyframes=None,
        refs=None,
    ):
        self.signature = (
            int(text_len),
            int(latent_t),
            int(latent_h),
            int(latent_w),
            int(audio_t),
        )
        frame_rows = (int(latent_h) // 2) * (int(latent_w) // 2)
        parts = [("text", int(text_len))]
        for keyframe in keyframes or ():
            latent = keyframe.get("latent")
            if latent is not None:
                parts.append(("cond", int(latent.shape[2]) * frame_rows))
            audio = keyframe.get("audio_latent")
            if audio is not None:
                parts.append(("cond_audio", int(audio.shape[-1]) * 2))
        for ref in refs or ():
            kind = ref["kind"]
            if kind == "image":
                parts.append(
                    (
                        "ref_img",
                        (int(ref["latent_h"]) // 2)
                        * (int(ref["latent_w"]) // 2),
                    )
                )
            elif kind == "audio":
                if int(ref["ref_audio_t"]) > 0:
                    parts.append(("ref_audio", int(ref["ref_audio_t"]) * 2))
            elif kind in ("video", "video_audio"):
                if int(ref["ref_audio_t"]) > 0:
                    parts.append(("ref_audio", int(ref["ref_audio_t"]) * 2))
                parts.append(
                    (
                        "ref_img",
                        int(ref["latent_t"])
                        * (int(ref["latent_h"]) // 2)
                        * (int(ref["latent_w"]) // 2),
                    )
                )
            else:
                raise ValueError(f"unsupported ref kind: {kind}")
        parts.extend(
            (
                ("audio", int(audio_t) * 2),
                ("video", int(latent_t) * frame_rows),
            )
        )
        row = 0
        self.segments = []
        for kind, count in parts:
            self.segments.append((row, row + count, kind))
            row += count
        self.seq_len = row
        self.position_ids = torch.zeros(row, 3, dtype=torch.float64)


def _layout(*, keyframes=None, refs=None):
    return FakePackedLayout(
        3,
        2,
        4,
        6,
        5,
        keyframes=keyframes,
        refs=refs,
    )


def test_preflight_accepts_self_consistent_visual_audio_and_multiple_blocks():
    first = torch.zeros(1, 24, 1, 4, 6)
    guide_audio = torch.zeros(1, 32, 2, 5)
    image = torch.zeros(1, 24, 1, 2, 4)
    video = torch.zeros(1, 24, 2, 2, 2)
    ref_audio = torch.zeros(1, 32, 2, 3)
    keyframes = [
        {"resolved_frame_index": 0, "latent": first},
        {"resolved_frame_index": 0, "audio_latent": guide_audio},
    ]
    refs = [
        {
            "kind": "image",
            "latent_h": 2,
            "latent_w": 4,
            "latent": image,
        },
        {
            "kind": "video_audio",
            "latent_t": 2,
            "latent_h": 2,
            "latent_w": 2,
            "ref_audio_t": 3,
            "latent": video,
            "audio_latent": ref_audio,
        },
    ]
    payload = {
        "layout": _layout(keyframes=keyframes, refs=refs),
        "keyframes": keyframes,
        "refs": refs,
    }
    normalize_condition_latents(payload)

    result = preflight_packed_layout(payload, repair_stale=False)

    assert result["status"] == "matched"
    assert result["layout_visual_rows"] == result["actual_visual_rows"] == 10
    assert result["layout_audio_rows"] == result["actual_audio_rows"] == 16
    assert len(result["visual_blocks"]) == 3
    assert len(result["audio_blocks"]) == 2


def test_preflight_accepts_frozen_second_pass_reference_mapping():
    # RefineContext freezes First Pass metadata as MappingProxyType. Core
    # PackedLayout accepts it, so the Continuum preflight must do the same.
    ref = MappingProxyType({
        "kind": "image", "latent_h": 42, "latent_w": 28,
        "latent": torch.zeros(1, 24, 1, 42, 28),
    })
    payload = {"layout": _layout(refs=[ref]), "refs": [ref]}
    normalize_condition_latents(payload)

    result = preflight_packed_layout(payload, repair_stale=False)

    assert result["status"] == "matched"
    assert result["layout_visual_rows"] == result["actual_visual_rows"] == 294
    assert result["repaired"] is False


def test_preflight_repairs_only_a_stale_layout_from_current_payload():
    first = torch.zeros(1, 24, 1, 4, 6)
    guide_audio = torch.zeros(1, 32, 2, 5)
    keyframes = [
        {"resolved_frame_index": 0, "latent": first},
        {"resolved_frame_index": 0, "audio_latent": guide_audio},
    ]
    stale = _layout(keyframes=None, refs=None)
    payload = {"layout": stale, "keyframes": keyframes, "refs": []}
    normalize_condition_latents(payload)

    result = preflight_packed_layout(payload, repair_stale=True)

    assert result["status"] == "layout_rebuilt"
    assert result["repaired"] is True
    assert payload["layout"] is not stale
    assert result["layout_visual_rows"] == result["actual_visual_rows"] == 6
    assert result["layout_audio_rows"] == result["actual_audio_rows"] == 10
    final = preflight_packed_layout(payload, repair_stale=False)
    assert final["status"] == "matched"


def test_preflight_rejects_keyframe_target_geometry_mismatch_without_mutation():
    first = torch.zeros(1, 24, 1, 4, 4)
    keyframes = [{"resolved_frame_index": 0, "latent": first}]
    payload = {
        "layout": _layout(keyframes=keyframes),
        "keyframes": keyframes,
        "refs": [],
    }
    original = first.clone()
    normalize_condition_latents(payload)

    with pytest.raises(LayoutCompatibilityError) as caught:
        preflight_packed_layout(payload, repair_stale=True)

    message = str(caught.value)
    assert "Visual block #1" in message
    assert "type: keyframe" in message
    assert "resolved_frame_index: 0" in message
    assert "latent shape: B=1 C=24 T=1 H=4 W=4" in message
    assert "expected rows: 6" in message
    assert "actual rows: 4" in message
    assert "delta: -2" in message
    assert "Unsafe geometry mismatch" in message
    assert "Sampling was not started" in message
    assert torch.equal(first, original)


def test_preflight_rejects_reference_metadata_geometry_mismatch():
    image = torch.zeros(1, 24, 1, 4, 4)
    refs = [
        {
            "kind": "image",
            "latent_h": 4,
            "latent_w": 6,
            "latent": image,
        }
    ]
    payload = {"layout": _layout(refs=refs), "keyframes": [], "refs": refs}
    normalize_condition_latents(payload)

    with pytest.raises(LayoutCompatibilityError) as caught:
        preflight_packed_layout(payload, repair_stale=True)

    message = str(caught.value)
    assert "type: ref_image" in message
    assert "reference metadata H/W (4, 6) != latent H/W (4, 4)" in message
    assert "expected rows: 6" in message
    assert "actual rows: 4" in message


def test_preflight_rejects_reference_audio_metadata_mismatch():
    audio = torch.zeros(1, 32, 2, 3)
    refs = [
        {
            "kind": "audio",
            "ref_audio_t": 4,
            "audio_latent": audio,
        }
    ]
    payload = {"layout": _layout(refs=refs), "keyframes": [], "refs": refs}
    normalize_condition_latents(payload)

    with pytest.raises(LayoutCompatibilityError) as caught:
        preflight_packed_layout(payload, repair_stale=True)

    message = str(caught.value)
    assert "Audio block #1" in message
    assert "type: ref_audio" in message
    assert "expected rows: 8" in message
    assert "actual rows: 6" in message
    assert "reference metadata audio_t 4 != latent audio_t 3" in message


def test_preflight_does_not_invent_a_layout_when_core_has_not_built_one():
    payload = {
        "keyframes": [
            {
                "resolved_frame_index": 0,
                "audio_latent": torch.zeros(1, 32, 2, 3),
            }
        ],
        "refs": [],
    }
    normalize_condition_latents(payload)

    result = preflight_packed_layout(payload, repair_stale=True)

    assert result == {
        "status": "layout_unavailable",
        "repaired": False,
        "visual_blocks": (),
        "audio_blocks": (),
    }
