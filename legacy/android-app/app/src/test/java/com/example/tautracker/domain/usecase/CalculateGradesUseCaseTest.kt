package com.example.tautracker.domain.usecase

import com.example.tautracker.data.remote.MoodleGradeItemInfo
import com.example.tautracker.data.remote.MoodleGradeTableData
import org.junit.Assert.assertEquals
import org.junit.Test

class CalculateGradesUseCaseTest {

    private val useCase = CalculateGradesUseCase()

    @Test
    fun `calculate valid grade`() {
        val tableData = listOf(
            MoodleGradeTableData(
                itemname = MoodleGradeItemInfo("Assignment 1"),
                grade = MoodleGradeItemInfo("85.5"),
                range = MoodleGradeItemInfo("0-100")
            )
        )

        val result = useCase.execute(tableData)
        assertEquals(1, result.size)
        assertEquals("Assignment 1", result[0].assignmentName)
        assertEquals(85.5, result[0].gradeValue)
        assertEquals(100.0, result[0].maxGrade)
        assertEquals(85.5, result[0].percentage)
        assertEquals(false, result[0].isHidden)
    }

    @Test
    fun `handle hidden grade`() {
        val tableData = listOf(
            MoodleGradeTableData(
                itemname = MoodleGradeItemInfo("Assignment 2"),
                grade = MoodleGradeItemInfo("-"),
                range = MoodleGradeItemInfo("0-10")
            )
        )

        val result = useCase.execute(tableData)
        assertEquals(1, result.size)
        assertEquals("Assignment 2", result[0].assignmentName)
        assertEquals(null, result[0].gradeValue)
        assertEquals(10.0, result[0].maxGrade)
        assertEquals(null, result[0].percentage)
        assertEquals(true, result[0].isHidden)
    }
}
