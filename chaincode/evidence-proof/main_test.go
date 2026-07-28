package main

import (
	"encoding/json"
	"testing"

	"github.com/hyperledger/fabric-chaincode-go/shimtest"
)

const proofID = "60000000-0000-4000-8000-000000000010"

func evidenceJSON(contentHash string) string {
	value := EvidenceProof{
		Kind:                  "EVIDENCE",
		SchemaVersion:         "1.0",
		ProofID:               proofID,
		OrganizationScopeHash: "a6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
		CaseReferenceHash:     "b6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
		EvidenceID:            "60000000-0000-4000-8000-000000000011",
		EvidenceVersionID:     "60000000-0000-4000-8000-000000000012",
		ContentSHA256:         contentHash,
		MetadataSHA256:        "d6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d",
	}
	raw, _ := canonicalJSON(value)
	return string(raw)
}

func TestCanonicalVector(t *testing.T) {
	value := map[string]any{"z": "last", "a": []any{float64(2), "x"}, "nested": map[string]any{"b": true, "a": nil}}
	canonical, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"a":[2,"x"],"nested":{"a":null,"b":true},"z":"last"}`
	if string(canonical) != expected {
		t.Fatalf("canonical mismatch: %s", canonical)
	}
	hash, _ := canonicalSHA256(value)
	if hash != "f00fd09a06465684b90b07fe3dba58e7a0faab663d087ea7d6362b80acb5e645" {
		t.Fatalf("hash mismatch: %s", hash)
	}
}

func TestAnchorIsIdempotentAndImmutable(t *testing.T) {
	stub := shimtest.NewMockStub("proof", &ProofChaincode{})
	hash := "c6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d"
	first := stub.MockInvoke("tx-1", [][]byte{[]byte("AnchorEvidenceProof"), []byte(evidenceJSON(hash))})
	if first.Status != 200 {
		t.Fatalf("anchor failed: %s", first.Message)
	}
	second := stub.MockInvoke("tx-2", [][]byte{[]byte("AnchorEvidenceProof"), []byte(evidenceJSON(hash))})
	if second.Status != 200 {
		t.Fatalf("idempotent anchor failed: %s", second.Message)
	}
	conflictHash := "e6c7c982ccf1c357173f0fb73a04c8f88e6a7061f649d7a104c1e41e1054162d"
	conflict := stub.MockInvoke("tx-3", [][]byte{[]byte("AnchorEvidenceProof"), []byte(evidenceJSON(conflictHash))})
	if conflict.Status == 200 || conflict.Message != "PROOF_ID_CONFLICT" {
		t.Fatalf("expected immutable conflict, got %d %s", conflict.Status, conflict.Message)
	}
}

func TestRejectsUnknownAndInvalidHashFields(t *testing.T) {
	var value map[string]any
	_ = json.Unmarshal([]byte(evidenceJSON("bad")), &value)
	value["customerName"] = "forbidden"
	raw, _ := json.Marshal(value)
	stub := shimtest.NewMockStub("proof", &ProofChaincode{})
	response := stub.MockInvoke("tx-4", [][]byte{[]byte("AnchorEvidenceProof"), raw})
	if response.Status == 200 {
		t.Fatal("invalid/PII-bearing input was accepted")
	}
}
